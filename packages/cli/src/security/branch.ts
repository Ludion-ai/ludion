import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { notSnapshotted } from "./project.ts";

/**
 * `--apply` puts each validated fix on its own branch: one commit on the commit it was validated against (gate 4, one
 * fix per commit). The working tree is not changed. Only Git plumbing runs, with the repository's hooks, fsmonitor and
 * signing out of reach and no filters: a project's Git configuration is data, never a command run on the host.
 */
export type GitBase = { top: string; prefix: string; commit: string; modes: Map<string, string> };

const IDENTITY = { GIT_AUTHOR_NAME: "Ludion", GIT_AUTHOR_EMAIL: "ludion@ludion.invalid", GIT_COMMITTER_NAME: "Ludion", GIT_COMMITTER_EMAIL: "ludion@ludion.invalid" };
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

function git(cwd: string, args: string[], options: { input?: string; index?: string; allowFail?: boolean } = {}): { status: number; stdout: string } {
  // An empty hooks folder for every call, so no hook of the repository (or of core.hooksPath) can run.
  const hooks = mkdtempSync(join(tmpdir(), "ludion-no-hooks-"));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
    Object.assign(env, IDENTITY, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, options.index ? { GIT_INDEX_FILE: options.index } : {});
    const config = [`core.hooksPath=${hooks}`, "core.fsmonitor=false", "core.splitIndex=false", "commit.gpgSign=false", "gc.auto=0", "maintenance.auto=false"].flatMap(c => ["-c", c]);
    const result = spawnSync("git", ["--no-pager", "--literal-pathspecs", ...config, ...args], { cwd, env, input: options.input, maxBuffer: 256 * 1024 * 1024, timeout: 60_000, windowsHide: true });
    if (result.error) throw new Error(`Git could not run: ${result.error.message}`);
    const status = result.status ?? -1;
    if (status !== 0 && !options.allowFail) throw new Error(`git ${args[0]} failed: ${plain(String(result.stderr)).trim().slice(-300)}`);
    return { status, stdout: String(result.stdout) };
  } finally { rmSync(hooks, { recursive: true, force: true }); }
}

/**
 * The commit to branch from: HEAD, when the validated copy of the project (`copy`, from snapshot) has exactly HEAD's
 * files. Files the snapshot leaves out, and the top-level names in `leftOut` that never reach the tests, are not compared.
 * A file may differ from HEAD only by CRLF line ends (a checkout with core.autocrlf).
 */
export function gitBase(root: string, copy: string, leftOut: readonly string[] = []): GitBase {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") throw new Error("--apply puts each fix on its own Git branch, and this project is not in a Git work tree. Nothing was validated or changed.");
  const top = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).stdout.trim());
  const prefix = git(root, ["rev-parse", "--show-prefix"]).stdout.trim();
  if (realpathSync(resolve(top, prefix || ".")) !== root) throw new Error("The project's folder is not where Git places it in the work tree; applying needs review.");
  const head = git(top, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { allowFail: true });
  if (head.status !== 0) throw new Error("The project's Git repository has no commit to branch from. Nothing was validated or changed.");
  const commit = head.stdout.trim();
  const tracked = new Map<string, { mode: string; oid: string }>();
  for (const line of git(top, ["ls-tree", "-r", "-z", "--full-tree", commit, ...(prefix ? ["--", prefix] : [])]).stdout.split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t"), [mode, type, oid] = line.slice(0, tab).split(" "), path = line.slice(tab + 1);
    if (!path.startsWith(prefix)) continue;
    const rel = path.slice(prefix.length), parts = rel.split("/");
    if (parts.some(notSnapshotted) || leftOut.includes(parts[0]!)) continue;
    if (type !== "blob" || mode === "120000") throw new Error(`The last commit has ${type === "commit" ? "a submodule" : "a symbolic link"} at ${plain(path)}; applying needs review.`);
    tracked.set(rel, { mode: mode!, oid: oid! });
  }
  const blob = (data: Buffer) => createHash(commit.length === 64 ? "sha256" : "sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
  const differs: string[] = [], seen = new Set<string>();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (!rel && leftOut.includes(name)) continue;
      const full = join(dir, name), key = rel ? `${rel}/${name}` : name;
      if (lstatSync(full).isDirectory()) { walk(full, key); continue; }
      seen.add(key);
      const data = readFileSync(full), oid = tracked.get(key)?.oid;
      if (oid !== blob(data) && oid !== blob(Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1"))) differs.push(key);
    }
  };
  walk(copy, "");
  for (const key of tracked.keys()) if (!seen.has(key)) differs.push(key);
  if (differs.length) throw new Error(`--apply branches from the last commit, and these project files differ from it: ${differs.sort().slice(0, 5).map(plain).join(", ")}${differs.length > 5 ? `, and ${differs.length - 5} more` : ""}. Commit or remove them first. Nothing was validated or changed.`);
  return { top, prefix, commit, modes: new Map([...tracked].map(([path, entry]) => [path, entry.mode])) };
}

/** A branch name from its parts: letters, digits, ".", "_" and "-" in each part. */
export function branchName(...parts: string[]): string {
  return parts.map(part => part.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+|[.-]+$/g, "").replace(/\.lock$/i, "-lock").slice(0, 80) || "x").join("/");
}

export function branchExists(base: GitBase, branch: string): boolean {
  return git(base.top, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { allowFail: true }).status === 0;
}

/**
 * One commit on base.commit with `files` (project-relative paths) replaced, on a new branch. An existing branch is
 * never moved: the ref is created only if it does not exist. Returns the commit.
 */
export function fixBranch(base: GitBase, branch: string, files: { path: string; content: string }[], message: string): string {
  const ref = `refs/heads/${branch}`;
  if (git(base.top, ["check-ref-format", ref], { allowFail: true }).status !== 0) throw new Error(`Invalid branch name: ${plain(branch)}`);
  const temp = mkdtempSync(join(tmpdir(), "ludion-index-")), index = join(temp, "index");
  try {
    git(base.top, ["read-tree", base.commit], { index });
    for (const file of files) {
      const oid = git(base.top, ["hash-object", "-w", "--no-filters", "--stdin"], { input: file.content }).stdout.trim();
      git(base.top, ["update-index", "--add", "--cacheinfo", base.modes.get(file.path) ?? "100644", oid, `${base.prefix}${file.path}`], { index });
    }
    const tree = git(base.top, ["write-tree"], { index }).stdout.trim();
    const commit = git(base.top, ["commit-tree", tree, "-p", base.commit, "--no-gpg-sign", "-F", "-"], { input: message.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ") }).stdout.trim();
    git(base.top, ["update-ref", "-m", "ludion: one fix", ref, commit, "0".repeat(base.commit.length)]);
    return commit;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
