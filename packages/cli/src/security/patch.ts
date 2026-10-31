import { randomUUID } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { runContainer, runDockerImageCommand } from "../../../sandbox/src/docker.ts";
import { hash, imageReason, replaceImage, scanPhp, type Scan } from "./php.ts";
import { scanNode } from "./node.ts";
import { privateState, readConfig, regularFile, rootPath, snapshot } from "./project.ts";
import { branchTip, fixBranch, fixBranchName, gitBase, skippedReason } from "./branch.ts";
import { nodeFixPublished, phpFixPublished, type FixPublished } from "./exposure.ts";

export type Command = (args: string[], timeoutMs: number) => Promise<string>;
export type Receipt = {
  schema: 1; id: string; started_at: string; finished_at: string;
  /** "skipped": with --apply, the branch for this update already exists; it was not validated again or changed. */
  outcome: "validated" | "applied" | "failed" | "skipped"; scope: "dockerfile_only_not_deployed";
  scan: Scan; tree_hash: string; dockerfile_before: string; dockerfile_after: string | null;
  old_digest: string | null; new_digest: string | null;
  test: string[]; baseline_passed: boolean; candidate_passed: boolean; reason?: string;
  /** Exposure-time timestamps (UTC): the fix's official publication, the release lookup of this run, the branch. */
  fix_published_at: string | null; fix_published_note: string; found_at: string; applied_at: string | null;
  /** --apply: the update is one commit on base_commit, on its own branch. The working tree is not changed. */
  base_commit: string | null; branch: string | null; commit: string | null;
};

export const dockerCommand: Command = runDockerImageCommand;

/** The official runtime images `patch` updates: its repository, release lookup, exposure start and version probe. */
const RUNTIMES = {
  php: {
    label: "PHP", scan: scanPhp, published: phpFixPublished,
    probe: (version: string) => ["php", "-r", `exit(PHP_VERSION === '${version}' ? 0 : 1);`],
  },
  node: {
    label: "Node.js", scan: scanNode, published: nodeFixPublished,
    probe: (version: string) => ["node", "-e", `process.exit(process.version === 'v${version}' ? 0 : 1)`],
  },
} satisfies Record<"php" | "node", { label: string; scan: (dockerfile: string, fetchFn?: typeof fetch) => Promise<Scan>; published: (scan: Scan) => FixPublished; probe: (version: string) => string[] }>;

function digestFrom(text: string, repository: keyof typeof RUNTIMES): string {
  const label = RUNTIMES[repository].label;
  let entries: unknown;
  try { entries = JSON.parse(text); } catch { throw new Error(`Could not read downloaded ${label} image digest.`); }
  if (!Array.isArray(entries)) throw new Error(`Missing official ${label} image digest.`);
  const digest = entries.find(v => typeof v === "string" && new RegExp(`^(?:(?:docker\\.io/)?library/)?${repository}@sha256:[a-f0-9]{64}$`).test(v));
  if (typeof digest !== "string") throw new Error(`Downloaded image has no official ${label} repository digest.`);
  return `${repository}@${digest.split("@")[1]!}`;
}

export async function patchProject(dir: string, apply: boolean, deps: { signal?: AbortSignal; fetchFn?: typeof fetch; command?: Command; testRun?: (name: string, image: string, command: readonly string[], timeoutMs: number) => Promise<void> } = {}): Promise<{ receipt: Receipt | null; path: string | null; scan: Scan }> {
  const active = () => { if (deps.signal?.aborted) throw new Error("Update cancelled. No pending source change will be applied."); };
  active();
  const root = rootPath(dir), config = readConfig(root);
  if (!("dockerfile" in config)) throw new Error("A PHP or Node.js image patch requires a Dockerfile configuration.");
  const repository = config.ecosystem === "node" ? "node" : "php", runtime = RUNTIMES[repository];
  const dockerfile = regularFile(root, config.dockerfile);
  const original = readFileSync(dockerfile, "utf8");
  const scan = await runtime.scan(original, deps.fetchFn);
  active();
  // No move, or a move with no newer security release still in its 72-hour wait ("wait"): no Docker work, no receipt.
  if (!scan.candidate || scan.status !== "update_available") return { receipt: null, path: null, scan };
  const state = privateState(root), lock = join(state, "patch.lock");
  let lockFd: number;
  try { lockFd = openSync(lock, "wx", 0o600); } catch { throw new Error("Another patch may be running, or patch.lock remains after an interruption. Inspect it before retrying."); }
  const id = randomUUID(), images: string[] = [];
  let temporary = "";
  const receiptPath = join(state, `${id}.json`), published = runtime.published(scan);
  const receipt: Receipt = {
    schema: 1, id, started_at: new Date().toISOString(), finished_at: "", outcome: "failed", scope: "dockerfile_only_not_deployed",
    scan, tree_hash: "", dockerfile_before: hash(original), dockerfile_after: null, old_digest: null, new_digest: null,
    test: [...config.test], baseline_passed: false, candidate_passed: false,
    fix_published_at: published.at, fix_published_note: published.note, found_at: scan.checked_at, applied_at: null,
    base_commit: null, branch: null, commit: null,
  };
  const command = deps.command ?? dockerCommand;
  const run = deps.testRun ?? (async (name, image, command, timeoutMs) => {
    const result = await runContainer(name, image, command, timeoutMs);
    if (result.kind === "spawn_error") throw new Error(`Docker unavailable: ${result.message}`);
    if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? "Validation timed out." : `Validation exited ${result.exitCode}: ${result.stderr.slice(-1000)}`);
  });
  try {
    temporary = mkdtempSync(join(tmpdir(), "ludion-security-"));
    writeFileSync(lockFd, JSON.stringify({ id, pid: process.pid, started_at: receipt.started_at }));
    receipt.tree_hash = snapshot(root, temporary);
    if (JSON.stringify(readConfig(temporary)) !== JSON.stringify(config)) throw new Error("Validation policy changed during scan; retry.");
    if (readFileSync(join(temporary, config.dockerfile), "utf8") !== original) throw new Error("Dockerfile changed during scan; retry.");
    // Before any Docker work: the branch starts from the commit whose files are the ones validated.
    const base = apply ? gitBase(root, temporary) : null;
    receipt.base_commit = base?.commit ?? null;
    const branch = base && fixBranchName(base.prefix, repository, null, [scan.candidate.version]);
    const subject = `ludion: ${runtime.label} ${scan.current.version} -> ${scan.candidate.version} in ${config.dockerfile}`;
    const tip = base && branch ? branchTip(base, branch) : null;
    // A branch of the same name is this update only when its tip says so; otherwise the name is taken and the update stops.
    if (tip !== null && tip.subject !== subject) throw new Error(`The branch ${branch} already exists and holds another change ("${tip.subject.slice(0, 200)}"); it was not changed, and this update was not validated.`);
    if (base && branch && tip?.subject === subject) {
      receipt.outcome = "skipped"; receipt.branch = branch;
      receipt.reason = skippedReason(base, branch, tip.parent, "update");
      return { receipt, path: receiptPath, scan };
    }
    for (const [label, ref, expected] of [
      ["baseline", scan.current.reference, scan.current.version],
      ["candidate", scan.candidate.reference, scan.candidate.version],
    ] as const) {
      active();
      await command(["pull", ref], 300_000);
      active();
      const digest = digestFrom(await command(["image", "inspect", ref, "--format", "{{json .RepoDigests}}"], 15_000), repository);
      active();
      if (label === "baseline") receipt.old_digest = digest; else receipt.new_digest = digest;
      const pinned = `${ref.split("@")[0]}@${digest.split("@")[1]}`;
      writeFileSync(join(temporary, config.dockerfile), replaceImage(original, scan.current, pinned));
      const image = `ludion-security-${id}-${label}`;
      images.push(image);
      await command(["build", "--network=none", "--pull=false", "--tag", image, "--file", join(temporary, config.dockerfile), temporary], 300_000);
      active();
      const imageId = await command(["image", "inspect", image, "--format", "{{.Id}}"], 15_000);
      active();
      const versionName = `ludion-security-${id}-${label}-runtime`;
      // Probe the built image as well as its base; a Dockerfile may replace the runtime's binary.
      await run(versionName, imageId, runtime.probe(expected), config.timeout_seconds * 1000);
      active();
      const name = `ludion-security-${id}-${label}-test`;
      await run(name, imageId, config.test, config.timeout_seconds * 1000);
      active();
      if (label === "baseline") receipt.baseline_passed = true; else receipt.candidate_passed = true;
    }
    const pinned = `${scan.candidate.reference}@${receipt.new_digest!.split("@")[1]}`;
    const updated = replaceImage(original, scan.current, pinned);
    receipt.dockerfile_after = hash(updated);
    active();
    if (snapshot(root) !== receipt.tree_hash || readFileSync(regularFile(root, config.dockerfile), "utf8") !== original) throw new Error("Project changed during validation. Dockerfile was not updated; retry.");
    receipt.outcome = "validated";
    receipt.finished_at = new Date().toISOString();
    // Persist the validation evidence before touching source. It is not a deployment or exploit-test receipt.
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (base && branch) {
      active();
      const message = `${subject}\n\n${imageReason(runtime.label, scan.candidate.version, scan.security_releases.map(r => r.version))}\n\nLudion receipt ${id}: the project's test passed on ${base.commit.slice(0, 12)} and on this change, offline in Docker.\nSource Dockerfile only; production was not changed.\n`;
      // The path as Git names it: "./Dockerfile" in the config is "Dockerfile" in the commit.
      receipt.commit = fixBranch(base, branch, [{ path: posix.normalize(config.dockerfile), content: updated }], message);
      receipt.branch = branch; receipt.applied_at = new Date().toISOString(); receipt.outcome = "applied";
    }
  } catch (err) {
    receipt.outcome = "failed";
    receipt.reason = err instanceof Error ? err.message : String(err);
  } finally {
    receipt.finished_at = new Date().toISOString();
    try {
      // No log of source contents, credentials, or test stdout. The evidence records outcomes and hashes.
      writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    } finally {
      for (const image of images) await command(["image", "rm", image], 15_000).catch(() => {});
      // temporary is an absolute private mkdtemp directory, never a computed project path.
      if (temporary && (resolve(temporary).startsWith(resolve(tmpdir()) + "/") || resolve(temporary).startsWith(resolve(tmpdir()) + "\\"))) rmSync(temporary, { recursive: true, force: true });
      closeSync(lockFd);
      rmSync(lock);
    }
  }
  return { receipt, path: receiptPath, scan };
}
