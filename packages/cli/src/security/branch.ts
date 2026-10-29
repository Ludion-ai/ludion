import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { notSnapshotted } from "./project.ts";

/**
 * `--apply` puts each validated fix on its own branch: one commit on the commit it was validated against (gate 4, one
 * fix per commit). The working tree is not changed. Only Git plumbing runs, with the repository's hooks, fsmonitor,
 * signing and transports out of reach and no filters, and a repository that names hooks in its configuration (which newer
 * Git runs whatever core.hooksPath says) is refused: a project's Git configuration is data, never a command
 * run on the host.
 */
export type GitBase = { top: string; prefix: string; commit: string; modes: Map<string, string>; crlf: Set<string> };

const IDENTITY = { GIT_AUTHOR_NAME: "Ludion", GIT_AUTHOR_EMAIL: "ludion@ludion.invalid", GIT_COMMITTER_NAME: "Ludion", GIT_COMMITTER_EMAIL: "ludion@ludion.invalid" };
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

function git(dir: string, args: string[], options: { input?: string; index?: string; allowFail?: boolean } = {}): { status: number; stdout: string } {
  // An empty hooks folder for every call, so no hook of the repository (or of core.hooksPath) can run. It is also the
  // working directory: Windows looks for git.exe in the child's working directory before PATH, so it is never the
  // project's folder, and the repository is named with -C instead.
  const hooks = mkdtempSync(join(tmpdir(), "ludion-no-hooks-"));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
    // No transport: a partial clone would otherwise fetch a missing object with the repository's remote command.
    Object.assign(env, IDENTITY, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "none" }, options.index ? { GIT_INDEX_FILE: options.index } : {});
    const config = [`core.hooksPath=${hooks}`, "core.fsmonitor=false", "core.splitIndex=false", "commit.gpgSign=false", "gc.auto=0", "maintenance.auto=false", "protocol.allow=never",
      // A repository's protocol.<name>.allow wins over protocol.allow, so each one is set here, where -c wins over it.
      ...["file", "ext", "ssh", "git", "http", "https"].map(name => `protocol.${name}.allow=never`)].flatMap(c => ["-c", c]);
    const result = spawnSync("git", ["-C", dir, "--no-pager", "--literal-pathspecs", ...config, ...args], { cwd: hooks, env, input: options.input, maxBuffer: 256 * 1024 * 1024, timeout: 60_000, windowsHide: true });
    if (result.error) throw new Error(`Git could not run: ${result.error.message}`);
    const status = result.status ?? -1;
    if (status !== 0 && !options.allowFail) throw new Error(`git ${args[0]} failed: ${plain(String(result.stderr)).trim().slice(-300)}`);
    return { status, stdout: String(result.stdout) };
  } finally { rmSync(hooks, { recursive: true, force: true }); }
}

/** Exit status 1 of `git config --get-regexp` means no match; any other failure is not read as "none". */
function configNames(dir: string, pattern: string): string[] {
  const found = git(dir, ["config", "--name-only", "--get-regexp", pattern], { allowFail: true });
  if (found.status !== 0 && found.status !== 1) throw new Error("The repository's Git configuration could not be read; applying needs review. Nothing was validated or changed.");
  return found.stdout.split("\n").filter(Boolean);
}

/** Configuration Git would act on whatever the -c settings say: refused, not overridden. Checked again before each branch. */
function refuseConfiguration(dir: string): void {
  // Hooks named in configuration (hook.<name>.command) run whatever core.hooksPath says.
  const hooks = configNames(dir, "^hook\\.");
  if (hooks.length) throw new Error(`The Git configuration names hooks (${hooks.slice(0, 3).map(plain).join(", ")}), which Git runs whatever core.hooksPath says; applying needs review. Nothing was validated or changed.`);
  // A partial clone fetches missing objects through its remote; it is refused, not only kept off the network.
  const promisor = configNames(dir, "^(extensions\\.partialclone|remote\\..*\\.promisor)$");
  if (promisor.length) throw new Error(`The repository is a partial clone (${promisor.slice(0, 3).map(plain).join(", ")}), which can fetch a missing object through its remote's command; applying needs review. Nothing was validated or changed.`);
}

/**
 * The commit to branch from: HEAD, when the validated copy of the project (`copy`, from snapshot) has exactly HEAD's
 * files. Files the snapshot leaves out, and the top-level names in `leftOut` that never reach the tests, are not compared.
 * A text file may differ from HEAD only by CRLF line ends (a checkout with core.autocrlf); the executable bit must match
 * HEAD's mode, except on Windows.
 */
export function gitBase(root: string, copy: string, leftOut: readonly string[] = []): GitBase {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") throw new Error("--apply puts each fix on its own Git branch, and this project is not in a Git work tree. Nothing was validated or changed.");
  refuseConfiguration(root);
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
  const differs: string[] = [], seen = new Set<string>(), crlfOnly = new Set<string>();
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (!rel && leftOut.includes(name)) continue;
      const full = join(dir, name), key = rel ? `${rel}/${name}` : name;
      if (lstatSync(full).isDirectory()) { walk(full, key); continue; }
      seen.add(key);
      const data = readFileSync(full), entry = tracked.get(key), same = entry?.oid === blob(data);
      // CRLF alone is allowed only in a text file (no NUL byte). The executable bit is compared where the file system has one.
      const crlf = !same && !data.includes(0) && entry?.oid === blob(Buffer.from(data.toString("latin1").replace(/\r\n/g, "\n"), "latin1"));
      const mode = process.platform === "win32" || !entry || (lstatSync(full).mode & 0o100 ? "100755" : "100644") === entry.mode;
      if (!entry || (!same && !crlf) || !mode) differs.push(key);
      if (crlf) crlfOnly.add(key);
    }
  };
  walk(copy, "");
  for (const key of tracked.keys()) if (!seen.has(key)) differs.push(key);
  if (differs.length) throw new Error(`--apply branches from the last commit, and these project files differ from it: ${differs.sort().slice(0, 5).map(plain).join(", ")}${differs.length > 5 ? `, and ${differs.length - 5} more` : ""}. Commit or remove them first. Nothing was validated or changed.`);
  return { top, prefix, commit, modes: new Map([...tracked].map(([path, entry]) => [path, entry.mode])), crlf: crlfOnly };
}

/**
 * A branch name from its parts: letters, digits, ".", "_" and "-" in each part. A part longer than 200 characters keeps
 * its first 180 and a hash of the whole, so a version at its end is never cut off.
 */
export function branchName(...parts: string[]): string {
  return parts.map(part => {
    const clean = part.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[.-]+|[.-]+$/g, "").replace(/\.lock$/i, "-lock") || "x";
    return clean.length <= 200 ? clean : `${clean.slice(0, 180).replace(/[.-]+$/, "")}-${createHash("sha256").update(part).digest("hex").slice(0, 12)}`;
  }).join("/");
}

/** The first line of the message of the branch's tip commit, or null when there is no such branch. */
export function branchSubject(base: GitBase, branch: string): string | null {
  const tip = git(base.top, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], { allowFail: true });
  if (tip.status !== 0) return null;
  const body = git(base.top, ["cat-file", "commit", tip.stdout.trim()]).stdout;
  return body.slice(body.indexOf("\n\n") + 2).split("\n")[0] ?? "";
}

/**
 * One commit on base.commit with `files` (project-relative paths HEAD has) replaced, on a new branch. A file the working
 * tree has only with CRLF line ends is committed with LF ends, as HEAD has it. An existing branch is never moved: the
 * ref is created only if it does not exist. Returns the commit.
 */
export function fixBranch(base: GitBase, branch: string, files: { path: string; content: string }[], message: string): string {
  const ref = `refs/heads/${branch}`;
  if (git(base.top, ["check-ref-format", ref], { allowFail: true }).status !== 0) throw new Error(`Invalid branch name: ${plain(branch)}`);
  refuseConfiguration(base.top);
  const unknown = files.filter(file => !base.modes.has(file.path));
  if (unknown.length) throw new Error(`The last commit has no ${unknown.map(f => plain(f.path)).join(", ")}; applying needs review.`);
  const temp = mkdtempSync(join(tmpdir(), "ludion-index-")), index = join(temp, "index");
  try {
    git(base.top, ["read-tree", base.commit], { index });
    for (const file of files) {
      const content = base.crlf.has(file.path) ? file.content.replace(/\r\n/g, "\n") : file.content;
      const oid = git(base.top, ["hash-object", "-w", "--no-filters", "--stdin"], { input: content }).stdout.trim();
      git(base.top, ["update-index", "--add", "--cacheinfo", base.modes.get(file.path)!, oid, `${base.prefix}${file.path}`], { index });
    }
    const tree = git(base.top, ["write-tree"], { index }).stdout.trim();
    const commit = git(base.top, ["commit-tree", tree, "-p", base.commit, "--no-gpg-sign", "-F", "-"], { input: message.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ") }).stdout.trim();
    git(base.top, ["update-ref", "-m", "ludion: one fix", ref, commit, "0".repeat(base.commit.length)]);
    return commit;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
