import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDockerRunner } from "../../../capability/src/executor.ts";
import { buildDockerRunArgs, runDockerImageCommand } from "../../../../tools/verify/src/docker.ts";
import { hash, replaceImage, scanPhp, type Scan } from "./php.ts";
import { privateState, readConfig, regularFile, rootPath, snapshot } from "./project.ts";

export type Command = (args: string[], timeoutMs: number) => Promise<string>;
export type Receipt = {
  schema: 1; id: string; started_at: string; finished_at: string;
  outcome: "validated" | "applied" | "failed"; scope: "dockerfile_only_not_deployed";
  scan: Scan; tree_hash: string; dockerfile_before: string; dockerfile_after: string | null;
  old_digest: string | null; new_digest: string | null;
  test: string[]; baseline_passed: boolean; candidate_passed: boolean; reason?: string;
};

export const dockerCommand: Command = runDockerImageCommand;

function digestFrom(text: string): string {
  let entries: unknown;
  try { entries = JSON.parse(text); } catch { throw new Error("Could not read downloaded PHP image digest."); }
  if (!Array.isArray(entries)) throw new Error("Missing official PHP image digest.");
  const digest = entries.find(v => typeof v === "string" && /^(?:(?:docker\.io\/)?library\/)?php@sha256:[a-f0-9]{64}$/.test(v));
  if (typeof digest !== "string") throw new Error("Downloaded image has no official PHP repository digest.");
  return `php@${digest.split("@")[1]!}`;
}

export function runArgs(name: string, image: string, command: string[]): string[] {
  return buildDockerRunArgs({ phase: "security", name, image, command });
}

export async function patchProject(dir: string, apply: boolean, deps: { signal?: AbortSignal; fetchFn?: typeof fetch; command?: Command; testRun?: (args: string[], name: string, timeoutMs: number) => Promise<void> } = {}): Promise<{ receipt: Receipt | null; path: string | null; scan: Scan }> {
  const active = () => { if (deps.signal?.aborted) throw new Error("Update cancelled. No pending source change will be applied."); };
  active();
  const root = rootPath(dir), config = readConfig(root);
  if (!("dockerfile" in config)) throw new Error("PHP patch requires a PHP Dockerfile configuration.");
  const dockerfile = regularFile(root, config.dockerfile);
  const original = readFileSync(dockerfile, "utf8");
  const scan = await scanPhp(original, deps.fetchFn);
  active();
  if (!scan.candidate) return { receipt: null, path: null, scan };
  const state = privateState(root), lock = join(state, "patch.lock");
  let lockFd: number;
  try { lockFd = openSync(lock, "wx", 0o600); } catch { throw new Error("Another patch may be running, or patch.lock remains after an interruption. Inspect it before retrying."); }
  const id = randomUUID(), images: string[] = [];
  let temporary = "";
  const receiptPath = join(state, `${id}.json`);
  const receipt: Receipt = {
    schema: 1, id, started_at: new Date().toISOString(), finished_at: "", outcome: "failed", scope: "dockerfile_only_not_deployed",
    scan, tree_hash: "", dockerfile_before: hash(original), dockerfile_after: null, old_digest: null, new_digest: null,
    test: [...config.test], baseline_passed: false, candidate_passed: false,
  };
  const command = deps.command ?? dockerCommand;
  const run = deps.testRun ?? (async (args, name, timeoutMs) => {
    const result = await createDockerRunner()({ args, containerName: name, timeoutMs });
    if (result.kind === "spawn_error") throw new Error(`Docker unavailable: ${result.message}`);
    if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? "Validation timed out." : `Validation exited ${result.exitCode}: ${result.stderr.slice(-1000)}`);
  });
  let staged: string | undefined;
  try {
    temporary = mkdtempSync(join(tmpdir(), "ludion-security-"));
    writeFileSync(lockFd, JSON.stringify({ id, pid: process.pid, started_at: receipt.started_at }));
    receipt.tree_hash = snapshot(root, temporary);
    if (JSON.stringify(readConfig(temporary)) !== JSON.stringify(config)) throw new Error("Validation policy changed during scan; retry.");
    if (readFileSync(join(temporary, config.dockerfile), "utf8") !== original) throw new Error("Dockerfile changed during scan; retry.");
    for (const [label, ref, expected] of [
      ["baseline", scan.current.reference, scan.current.version],
      ["candidate", scan.candidate.reference, scan.candidate.version],
    ] as const) {
      active();
      await command(["pull", ref], 300_000);
      active();
      const digest = digestFrom(await command(["image", "inspect", ref, "--format", "{{json .RepoDigests}}"], 15_000));
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
      // Probe the built image as well as its base; a Dockerfile may replace the PHP binary.
      await run(runArgs(versionName, imageId, ["php", "-r", `exit(PHP_VERSION === '${expected}' ? 0 : 1);`]), versionName, config.timeout_seconds * 1000);
      active();
      const name = `ludion-security-${id}-${label}-test`;
      await run(runArgs(name, imageId, config.test), name, config.timeout_seconds * 1000);
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
    if (apply) {
      active();
      staged = `${dockerfile}.ludion-${id}.tmp`;
      writeFileSync(staged, updated, { flag: "wx", mode: lstatSync(dockerfile).mode & 0o777 });
      renameSync(staged, dockerfile);
      staged = undefined;
      receipt.outcome = "applied";
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
      if (staged && existsSync(staged)) rmSync(staged);
      // temporary is an absolute private mkdtemp directory, never a computed project path.
      if (temporary && (resolve(temporary).startsWith(resolve(tmpdir()) + "/") || resolve(temporary).startsWith(resolve(tmpdir()) + "\\"))) rmSync(temporary, { recursive: true, force: true });
      closeSync(lockFd);
      rmSync(lock);
    }
  }
  return { receipt, path: receiptPath, scan };
}
