import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findProgram } from "../../../sandbox/src/docker.ts";
import { notSnapshotted } from "./project.ts";

/**
 * `--apply` puts each validated fix on its own branch: one commit on the commit it was validated against (gate 4, one
 * fix per commit). The working tree is not changed. Only Git plumbing runs, with the repository's hooks, fsmonitor,
 * signing, transports and replace refs out of reach and no filters, and git itself found by absolute path outside the
 * repository. A repository that names hooks in its configuration (which newer Git runs whatever core.hooksPath says) is
 * refused: a project's Git configuration is data, never a command run on the host.
 */
export type GitBase = { top: string; prefix: string; commit: string; modes: Map<string, string>; crlf: Set<string> };

const IDENTITY = { GIT_AUTHOR_NAME: "Ludion", GIT_AUTHOR_EMAIL: "ludion@ludion.invalid", GIT_COMMITTER_NAME: "Ludion", GIT_COMMITTER_EMAIL: "ludion@ludion.invalid" };
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");

/**
 * The -c settings of every call besides core.hooksPath. core.fsmonitor is empty, not "false": before Git 2.36 the setting
 * is a hook path, and "false" runs a program named false from PATH (docs/mistakes/2026-10-29-fsmonitor-false-is-a-program.md).
 * A repository's protocol.<name>.allow wins over protocol.allow, so each one is set here, where -c wins over it.
 */
export const GIT_SETTINGS: readonly string[] = ["core.fsmonitor=", "core.splitIndex=false", "commit.gpgSign=false", "gc.auto=0", "maintenance.auto=false", "protocol.allow=never",
  ...["file", "ext", "ssh", "git", "http", "https"].map(name => `protocol.${name}.allow=never`)];

/**
 * The host's git, by absolute path, from PATH's absolute folders by findProgram's rules (packages/sandbox/src/docker.ts):
 * not the working directory, a node_modules folder (npx, npm exec and package scripts put the project's
 * node_modules/.bin first) or Yarn's shim folder, and nothing inside the repository (a Composer vendor/bin or a
 * .venv/bin the project's scripts put on PATH). The repository is the nearest folder at or above `dir` with a .git
 * entry, where Git itself looks, so for a project in a subfolder it is the whole repository.
 */
function gitProgram(dir: string): string {
  let top = realpathSync(dir);
  for (let at = top; ; at = dirname(at)) {
    if (existsSync(join(at, ".git"))) { top = at; break; }
    if (dirname(at) === at) break;
  }
  const program = findProgram("git", process.env.PATH ?? "", process.cwd(), process.platform, top);
  if (!program) throw new Error("--apply needs git, and none was found in PATH's absolute folders (the working directory, the repository, node_modules folders and Yarn's shim folder are skipped). Run without --apply to validate only. Nothing was validated or changed.");
  return program;
}

function git(dir: string, args: string[], options: { input?: string; index?: string; allowFail?: boolean } = {}): { status: number; stdout: string } {
  const program = gitProgram(dir);
  // An empty hooks folder for every call, so no hook of the repository (or of core.hooksPath) can run. It is also the
  // working directory, never the project's folder, and the repository is named with -C instead.
  const hooks = mkdtempSync(join(tmpdir(), "ludion-no-hooks-"));
  try {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
    // No transport: a partial clone would otherwise fetch a missing object with the repository's remote command. No
    // replace refs: the commit and tree read are HEAD's own, not a replacement the repository names.
    Object.assign(env, IDENTITY, { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "none", GIT_NO_REPLACE_OBJECTS: "1" }, options.index ? { GIT_INDEX_FILE: options.index } : {});
    const config = [`core.hooksPath=${hooks}`, ...GIT_SETTINGS].flatMap(c => ["-c", c]);
    const result = spawnSync(program, ["-C", dir, "--no-pager", "--no-replace-objects", "--literal-pathspecs", ...config, ...args], { cwd: hooks, env, input: options.input, maxBuffer: 256 * 1024 * 1024, timeout: 60_000, windowsHide: true });
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
  // Only the files ref storage, whose paths refuseLinks checks; reftable keeps refs in a folder of its own. Git reads the
  // repository format from the repository's own config file without includes, so that is what is read here, and newer
  // Git is also asked directly.
  const common = realpathSync(resolve(dir, git(dir, ["rev-parse", "--git-common-dir"]).stdout.trim()));
  const storage = git(dir, ["config", "--file", join(common, "config"), "--no-includes", "--get", "extensions.refstorage"], { allowFail: true });
  if (storage.status !== 0 && storage.status !== 1) throw new Error("The repository's Git configuration could not be read; applying needs review. Nothing was validated or changed.");
  const format = git(dir, ["rev-parse", "--show-ref-format"], { allowFail: true }).stdout.trim();
  const named = storage.status === 0 ? storage.stdout.trim().toLowerCase() : format === "reftable" ? "reftable" : "files";
  if (named !== "files") throw new Error(`The repository keeps its refs in ${plain(named)} storage, not files; applying needs review. Nothing was validated or changed.`);
  // Alternates: Git reads and touches objects in other folders the repository names.
  if (existsSync(join(common, "objects", "info", "alternates"))) throw new Error("The repository borrows objects from other folders (objects/info/alternates); applying needs review. Nothing was validated or changed.");
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
  if (differs.length) throw new Error(`--apply branches from the last commit, and these project files differ from it: ${differs.sort().slice(0, 5).map(plain).join(", ")}${differs.length > 5 ? `, and ${differs.length - 5} more` : ""}. Commit or remove them first; files Git stores through a filter (Git LFS, git-crypt) and a sparse checkout cannot be applied to. Nothing was validated or changed.`);
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

/** The branch's tip commit: the first line of its message and its first parent; null when there is no such branch. */
export function branchTip(base: GitBase, branch: string): { subject: string; parent: string | null } | null {
  const tip = git(base.top, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], { allowFail: true });
  if (tip.status !== 0) return null;
  const body = git(base.top, ["cat-file", "commit", tip.stdout.trim()]).stdout, headers = body.slice(0, body.indexOf("\n\n"));
  return { subject: body.slice(body.indexOf("\n\n") + 2).split("\n")[0] ?? "", parent: /^parent ([0-9a-f]+)$/m.exec(headers)?.[1] ?? null };
}

/** The reason a fix is skipped because its branch exists, saying when the branch starts from another commit than HEAD. */
export function skippedReason(base: GitBase, branch: string, parent: string | null, what: "fix" | "update"): string {
  const older = parent !== base.commit ? ` It starts from ${parent ? parent.slice(0, 12) : "no commit"}, not from HEAD ${base.commit.slice(0, 12)}: merge or delete it for this ${what} to be validated again.` : "";
  return `The branch ${branch} already exists; this ${what} was not validated again and the branch was not changed.${older}`;
}

/**
 * Git writes the branch's ref, its reflog and loose objects inside the repository's .git folder. A symbolic link (or a
 * Windows junction) on any of those paths would make it write outside the repository, so it is refused, and so is a
 * reflog the new branch already has.
 */
function refuseLinks(base: GitBase, branch: string): void {
  const common = realpathSync(resolve(base.top, git(base.top, ["rev-parse", "--git-common-dir"]).stdout.trim()));
  const linked: string[] = [];
  const check = (rel: string) => { try { if (lstatSync(join(common, rel)).isSymbolicLink()) linked.push(rel); } catch { /* absent: Git creates a real one */ } };
  const parts = ["refs", "heads", ...branch.split("/")];
  for (let i = 1; i <= parts.length; i++) { check(parts.slice(0, i).join("/")); check(["logs", ...parts.slice(0, i)].join("/")); }
  check("logs"); check("objects"); check("reftable");
  // Every loose object file: a link where Git writes a blob, tree or commit would make Git take the object as present
  // and touch the target.
  // Fails closed: only a missing objects folder reads as empty, and a fan-out entry that is not a real folder refuses.
  let names: string[] = [];
  try { names = readdirSync(join(common, "objects")); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("The repository's objects folder could not be read; applying needs review."); }
  for (const name of names) {
    check(`objects/${name}`);
    // Any letter case: on a case-insensitive file system Git writes objects/c0/ into a folder named C0.
    if (!/^[0-9a-f]{2}$/i.test(name)) continue;
    const stat = lstatSync(join(common, "objects", name));
    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory()) { linked.push(`objects/${name} (not a folder)`); continue; }
    for (const file of readdirSync(join(common, "objects", name))) check(`objects/${name}/${file}`);
  }
  if (linked.length) throw new Error(`The repository's .git folder has a symbolic link where Git would write (${linked.slice(0, 3).map(plain).join(", ")}); applying needs review.`);
  if (existsSync(join(common, "logs", ...parts))) throw new Error(`A reflog for the new branch ${plain(branch)} already exists; applying needs review.`);
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
  if (git(base.top, ["symbolic-ref", "--quiet", ref], { allowFail: true }).status === 0) throw new Error(`${plain(ref)} is a symbolic ref; it was not changed, and applying needs review.`);
  const contents = files.map(file => base.crlf.has(file.path) ? file.content.replace(/\r\n/g, "\n") : file.content);
  refuseLinks(base, branch);
  const unknown = files.filter(file => !base.modes.has(file.path));
  if (unknown.length) throw new Error(`The last commit has no ${unknown.map(f => plain(f.path)).join(", ")}; applying needs review.`);
  const temp = mkdtempSync(join(tmpdir(), "ludion-index-")), index = join(temp, "index");
  try {
    git(base.top, ["read-tree", base.commit], { index });
    for (const [i, file] of files.entries()) {
      const oid = git(base.top, ["hash-object", "-w", "--no-filters", "--stdin"], { input: contents[i] }).stdout.trim();
      git(base.top, ["update-index", "--add", "--cacheinfo", base.modes.get(file.path)!, oid, `${base.prefix}${file.path}`], { index });
    }
    const tree = git(base.top, ["write-tree"], { index }).stdout.trim();
    const commit = git(base.top, ["commit-tree", tree, "-p", base.commit, "--no-gpg-sign", "-F", "-"], { input: message.replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, " ") }).stdout.trim();
    // Git takes an object already present at an id as that object, so a planted one would stand in for ours. Read back
    // what the branch would hold: the commit's tree and only parent, the files it changes, and each file's bytes.
    const headers = git(base.top, ["cat-file", "commit", commit]).stdout.split("\n\n")[0]!.split("\n");
    if (headers.find(h => h.startsWith("tree ")) !== `tree ${tree}` || headers.filter(h => h.startsWith("parent ")).join("\n") !== `parent ${base.commit}`) throw new Error("The commit Git wrote is not the one made; applying needs review.");
    const changed = git(base.top, ["diff-tree", "-r", "-z", "--no-renames", base.commit, commit]).stdout.split("\0").filter(Boolean);
    const paths = changed.filter((_, i) => i % 2 === 1), expected = files.map(file => `${base.prefix}${file.path}`);
    // Each changed file keeps HEAD's mode: a planted tree could otherwise make it executable, a link or a submodule.
    const modes = changed.filter((_, i) => i % 2 === 0).map(meta => meta.split(" ")[1]);
    if (modes.some((mode, i) => mode !== base.modes.get(paths[i]!.slice(base.prefix.length)))) throw new Error("The tree Git wrote changes a file's mode; applying needs review.");
    if (paths.sort().join("\0") !== [...expected].sort().join("\0")) throw new Error(`The branch would change ${paths.map(plain).join(", ") || "nothing"}, not only ${expected.map(plain).join(", ")}; applying needs review.`);
    for (const [i, file] of files.entries()) {
      if (git(base.top, ["cat-file", "blob", `${commit}:${base.prefix}${file.path}`]).stdout !== contents[i]) throw new Error(`The repository already holds another object for the new ${plain(file.path)}; applying needs review.`);
    }
    // A symbolic ref at this name was refused above; --no-deref keeps update-ref from following one in any case.
    git(base.top, ["update-ref", "--no-deref", "-m", "ludion: one fix", ref, commit, "0".repeat(base.commit.length)]);
    return commit;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
