// Runs lesson test code in Docker with the network off (CLAUDE.md, "Lesson code runs only in Docker with the
// network off"). A test that pins package versions installs in containers that are separate from the run.
// Node uses two install containers (a lockfile, then npm ci). Python is not installed: lessons carry no
// hashes. The lesson code then runs in a fresh container with the network off. The lockfile is resolved
// from the registry at verify time (trust on first use). A lesson does not carry a lockfile; that would
// be a schema change, and it is not done here.
//
// Every `docker run` argument list is built by buildDockerRunArgs. The hardening flags are added there and
// are not caller options, so a caller cannot drop them. The only host input is the process uid/gid, read
// inside that function, and it is never taken from the options object.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { VERIFIER_STORE_PREFIX, isInside } from "./verifier-deps.ts";

/** What to run: a format 0 runner (python, bash, node) or a format 1 runtime (node@24, python@3.12, …). */
export interface RunSpec {
  runtime: string;
  code: string;
  /** Exact package versions to install first (npm for node, pypi for python). */
  packages?: Record<string, string>;
}

export type RawRun =
  | { kind: "done"; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
  | { kind: "error"; reason: string };

export type RunFn = (spec: RunSpec) => Promise<RawRun>;

const TIMEOUT_MS = 30_000;
/** Tests that install packages usually start a tool (vitest, wrangler): give them longer. */
const TIMEOUT_WITH_PACKAGES_MS = 90_000;
const INSTALL_TIMEOUT_MS = 180_000;
const OUTPUT_LIMIT = 4000;

interface Image {
  image: string;
  command: string[];
  language: "node" | "python";
}

/**
 * Multi-arch OCI image index digests. Fetched 2026-10-25 JST from the Docker Hub registry API:
 * HEAD /v2/library/<repo>/manifests/<tag>, Docker-Content-Digest header. These are index digests,
 * not single-platform manifests. Updating a pin changes which bytes the sandbox runs and is a reviewed change.
 */
export const IMAGE_DIGESTS = {
  "node:18-slim": "sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e",
  "node:20-slim": "sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0",
  "node:22-slim": "sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d",
  "node:24-slim": "sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205",
  "python:3.9-slim": "sha256:2d97f6910b16bd338d3060f261f53f144965f755599aab1acda1e13cf1731b1b",
  "python:3.10-slim": "sha256:6ff506466f8b1e981719b468cc0023b8ef000b983cdec0eafe119d01f379e31d",
  "python:3.11-slim": "sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377",
  "python:3.12-slim": "sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704",
  "python:3.13-slim": "sha256:d98cc29d3266e535dd9da1099688d9cb3ca4753813571e071763d17725460962",
  "python:3.14-slim": "sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8",
} as const;

type ImageTag = keyof typeof IMAGE_DIGESTS;

const PINNED_IMAGE = /@sha256:[a-f0-9]{64}$/;

function pinnedImage(tag: string): string | undefined {
  if (!Object.hasOwn(IMAGE_DIGESTS, tag)) return undefined;
  return `${tag}@${IMAGE_DIGESTS[tag as ImageTag]}`;
}

/** The image and command for a runner or runtime (docs/decisions.md, CI). Undefined if unknown or unpinned. */
export function imageFor(runtime: string): Image | undefined {
  let tag: string;
  let command: string[];
  let language: "node" | "python";
  if (runtime === "python") {
    tag = "python:3.14-slim";
    command = ["python", "-"];
    language = "python";
  } else if (runtime === "bash") {
    tag = "python:3.14-slim";
    command = ["bash", "-s"];
    language = "python";
  } else if (runtime === "node") {
    tag = "node:24-slim";
    command = ["node", "-"];
    language = "node";
  } else {
    const m = /^(node|python)@(\d+(?:\.\d+)?)$/.exec(runtime);
    const family = m?.[1];
    const version = m?.[2];
    if ((family !== "node" && family !== "python") || version === undefined) return undefined;
    tag = `${family}:${version}-slim`;
    command = family === "node" ? ["node", "-"] : ["python", "-"];
    language = family === "node" ? "node" : "python";
  }
  const image = pinnedImage(tag);
  // No floating tag. A runtime with no reviewed digest is rejected.
  if (!image) return undefined;
  return { image, command, language };
}

/** Pull the images these runtimes need, before any timed run starts. Returns a message per image that failed. */
export function pullImages(runtimes: Iterable<string>): string[] {
  const failures: string[] = [];
  const images = new Set([...runtimes].map((r) => imageFor(r)?.image).filter((i): i is string => !!i));
  for (const image of images) {
    if (!PINNED_IMAGE.test(image)) {
      failures.push(`Refusing to pull ${image}: the image is not pinned by digest.`);
      continue;
    }
    const r = spawnSync("docker", ["pull", "--quiet", image], { stdio: ["ignore", "inherit", "inherit"] });
    if (r.status !== 0) failures.push(`Could not pull ${image}${r.error ? ` (${r.error.message})` : ""}.`);
  }
  return failures;
}

/**
 * Numeric uid:gid for --user. The host uid and gid are used on POSIX when both are non-zero, so files
 * the container writes into the bind-mounted work folder can be removed by the host. Root (0) is never
 * used. Windows has no uid, and a root host is not passed through: both fall back to 1000:1000.
 */
export function resolveSandboxUser(uid: number | undefined, gid: number | undefined): string {
  if (typeof uid === "number" && typeof gid === "number" && Number.isInteger(uid) && Number.isInteger(gid) && uid > 0 && gid > 0) {
    return `${uid}:${gid}`;
  }
  return "1000:1000";
}

function hostIds(): { uid: number | undefined; gid: number | undefined } {
  return {
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    gid: typeof process.getgid === "function" ? process.getgid() : undefined,
  };
}

/** True when --user is the fixed 1000:1000 fallback rather than the host uid and gid. */
export function sandboxUserIsFallback(): boolean {
  const { uid, gid } = hostIds();
  return !(typeof uid === "number" && typeof gid === "number" && Number.isInteger(uid) && Number.isInteger(gid) && uid > 0 && gid > 0);
}

function sandboxUser(): string {
  const { uid, gid } = hostIds();
  const user = resolveSandboxUser(uid, gid);
  if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(user)) throw new Error("Sandbox user must be a non-root numeric uid:gid.");
  return user;
}

/**
 * A throwaway mkdtemp directory is mode 0700 and owned by the host. When the container runs as the
 * fallback user, that user cannot write it, and the host may be unable to unlink files the container
 * creates unless the directory itself is writable. 0777 is safe here: the directory is private, not
 * shared, and runInDocker deletes it in a finally block. Not used when the container is the host user.
 */
export function prepareSandboxWorkDir(workDir: string): void {
  if (sandboxUserIsFallback()) chmodSync(workDir, 0o777);
}

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ALLOWED_OPTIONS = new Set(["phase", "runtime", "name", "workDir", "packages", "verifierDeps", "installStep"]);
const REGISTRY_TARBALL = "https://registry.npmjs.org/";
const SHA256_HASH = /^sha256:[0-9a-f]{64}$/;
const NON_REGISTRY_SPEC = /^(?:git\+|git:|github:|gitlab:|bitbucket:|file:|link:|http:\/\/|https:\/\/)/i;

export type InstallStep = "npm-lock" | "npm-ci" | "pip";

/** npm install environment. The user and global config paths are not created, so no npmrc is read. */
const NPM_INSTALL_ENV = [
  "HOME=/w/.home",
  "npm_config_cache=/w/.npm",
  "npm_config_userconfig=/w/.npmrc",
  "npm_config_globalconfig=/w/.npmrc-global",
] as const;

/** pip install environment. The config path is not created, so no pip.conf is read. */
const PIP_INSTALL_ENV = ["HOME=/w/.home", "PIP_CONFIG_FILE=/w/pip.conf"] as const;

const RUN_ENV = ["HOME=/tmp", "NODE_PATH=/w/node_modules", "PYTHONPATH=/w/site", "LUDION_PACKAGES=/w"] as const;

function requireName(name: string): string {
  if (typeof name !== "string" || !CONTAINER_NAME.test(name)) {
    throw new Error(`Container name ${JSON.stringify(name)} is not a single safe token.`);
  }
  return name;
}

/**
 * Lexical form of a bind-mount source. A comma or an extra colon would be read by Docker as mount
 * options (`-v host,opt:/w` or `-v host:/etc:ro`). A Windows drive prefix is rewritten to `/c/...`
 * so the value that is actually passed has no colon; any other colon is rejected.
 */
function formatDockerSource(workDir: string, what: string): string {
  if (typeof workDir !== "string" || workDir.length === 0 || workDir.length > 4096) {
    throw new Error(`${what} must be an absolute path.`);
  }
  if (/[\0\r\n]/.test(workDir) || workDir.includes(",")) {
    throw new Error(`${what} contains a character that would change the mount.`);
  }
  let source = workDir;
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(workDir);
  if (drive) {
    const letter = drive[1];
    const rest = drive[2];
    if (letter === undefined || rest === undefined || rest.includes(":")) {
      throw new Error(`${what} contains a character that would change the mount.`);
    }
    source = `/${letter.toLowerCase()}/${rest.replace(/\\/g, "/")}`;
  } else if (workDir.includes(":") || workDir.includes("\\") || !workDir.startsWith("/")) {
    throw new Error(workDir.includes(":") || workDir.includes("\\")
      ? `${what} contains a character that would change the mount.`
      : `${what} must be an absolute path.`);
  }
  const parts = source.split("/");
  if (!source.startsWith("/") || parts.slice(1).some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`${what} must be an absolute path without '.' or '..'.`);
  }
  if (/[,:]/.test(source)) throw new Error(`${what} contains a character that would change the mount.`);
  // The destination is not part of the source. Checking `source:/w` proves the source itself
  // contributes no colon and no comma, whether the caller later mounts it at /w or /verifier:ro.
  const spec = `${source}:/w`;
  if (!spec.endsWith(":/w") || spec.slice(0, -3).includes(":") || spec.includes(",")) {
    throw new Error(`${what} contains a character that would change the mount.`);
  }
  return source;
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** realpath(os.tmpdir()) and, when it exists, realpath(RUNNER_TEMP). */
function mountRoots(): string[] {
  const roots: string[] = [];
  try {
    const temp = realpathSync(tmpdir());
    if (lstatSync(temp).isDirectory()) roots.push(temp);
  } catch {
    // No temp root means nothing may be mounted.
  }
  const runner = process.env.RUNNER_TEMP;
  if (typeof runner === "string" && runner.length > 0) {
    try {
      const real = realpathSync(runner);
      if (lstatSync(real).isDirectory()) roots.push(real);
    } catch {
      // A missing RUNNER_TEMP does not widen the allowlist.
    }
  }
  return roots;
}

/**
 * Reject a real directory that is outside the runner temp roots, that has a top-level `.git`
 * entry, or that sits inside a git work tree at or below the allowed root.
 */
function assertMountAllowed(real: string, what: string): void {
  const roots = mountRoots().filter((root) => isInside(real, root));
  if (roots.length === 0) throw new Error(`${what} must be an existing directory inside the runner temp directory.`);
  roots.sort((a, b) => a.length - b.length);
  const allowed = roots[0];
  if (allowed === undefined) throw new Error(`${what} must be an existing directory inside the runner temp directory.`);
  let current = real;
  for (;;) {
    if (existsSync(join(current, ".git"))) {
      throw new Error(samePath(current, real) ? `${what} contains .git.` : `${what} is inside a git work tree.`);
    }
    if (samePath(current, allowed)) break;
    const parent = dirname(current);
    if (samePath(parent, current)) break;
    current = parent;
  }
}

/**
 * Absolute host path safe to place before `:` in a bind mount. The source is realpath'd and
 * accepted only inside realpath(os.tmpdir()) or, when set, realpath(RUNNER_TEMP). A symlink or
 * junction whose target leaves that root is rejected. `what` is only the noun in the error text.
 * Work directories and the verifier deps directory share this check.
 */
export function dockerMountSource(workDir: string, what = "Work directory"): string {
  formatDockerSource(workDir, what);
  let real: string;
  try {
    real = realpathSync(workDir);
    if (!lstatSync(real).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`${what} must be an existing directory inside the runner temp directory.`);
  }
  assertMountAllowed(real, what);
  return formatDockerSource(real, what);
}

function validatedPackages(packages: Record<string, string> | undefined): [string, string][] {
  if (packages === undefined) return [];
  if (typeof packages !== "object" || packages === null || Array.isArray(packages)) {
    throw new Error("Packages must be a map of name to version.");
  }
  const entries: [string, string][] = [];
  for (const [name, version] of Object.entries(packages)) {
    if (typeof version !== "string" || !PACKAGE_NAME.test(name) || !PACKAGE_VERSION.test(version)) {
      throw new Error(`Package ${name}@${String(version)} is not an exact name and version.`);
    }
    entries.push([name, version]);
  }
  return entries;
}

/**
 * Closed option set. There is no field for extra docker flags, a user, a network mode, or capabilities.
 * Unknown keys are rejected at runtime as well, so a cast or a spread cannot smuggle them in.
 */
export interface DockerRunOptions {
  /** "run" executes lesson code. "install" runs only npm or pip, with scripts disabled. */
  phase: "run" | "install";
  runtime: string;
  /** Container name. One token, no spaces. */
  name: string;
  /**
   * Absolute host directory. Optional for a run with no packages.
   * Install bind-mounts it writable at /w. Run does not bind-mount it: /w is a tmpfs,
   * and node_modules (node) or site (python) is bind-mounted read-only beneath /w
   * when that directory exists.
   */
  workDir?: string;
  /**
   * Absolute host directory of the isolated verifier install, bind-mounted at /verifier.
   * Run phase only. The mount is always read-only (`:ro`); there is no field to drop that.
   */
  verifierDeps?: string;
  /** Exact package versions. Install phase only. They are not lesson code and are not put on the argv. */
  packages?: Record<string, string>;
  /** Which install container to build. Required for phase "install", rejected for "run". */
  installStep?: InstallStep;
}

/**
 * The only builder of `docker run` arguments. Hardening flags are unconditional.
 *
 * Network is a property of the phase, not a caller option:
 * - phase "run" executes lesson code and ALWAYS sets the network to none;
 * - phase "install" is the only phase that keeps Docker's default network. It runs npm or pip with
 *   install scripts disabled and no lesson code, so it can reach a registry.
 *
 * /tmp is always `--tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m`. A run that has a work directory
 * also sets `--tmpfs /w:rw,noexec,nosuid,nodev,size=128m,mode=1777` and `-w /w`. That /w is scratch
 * for lesson code (for example `mkdir /w/proj`). It is not a bind of the host work directory, so
 * those writes are not persisted and are not host-backed. Install results are the only host paths
 * mounted into it, and only read-only: `<workDir>/node_modules` at `/w/node_modules` for a node
 * runtime, `<workDir>/site` at `/w/site` for a python runtime, each only when that directory exists.
 * Both sources go through dockerMountSource. `:ro` is a literal appended in this function. The run
 * phase never bind-mounts the work directory. The install phase still bind-mounts the work directory
 * writable at /w and writes the tree, HOME (`/w/.home`), the npm cache (`/w/.npm`), and the pip
 * target (`/w/site`) there. pip and npm still unpack through /tmp, which a read-only root would
 * make immutable. No tmpfs is added for /var, /run, or /home. A run with no work directory is
 * unchanged: no /w tmpfs and no work bind.
 *
 * Docker does not forward the host environment into a container unless `--env-file` or `-e NAME`
 * (no value) asks it to. Neither is used. Every `-e` is an explicit `NAME=value` from the allowlist
 * for that phase. Image ENV is not wiped; the pinned images do not carry registry tokens, and naming
 * a token variable on the argv would itself put that word in the argument list.
 *
 * When `verifierDeps` is set on a run, it is mounted at /verifier with `:ro` appended by this
 * function. The option is rejected for the install phase. A verifier deps directory that contains
 * the work directory, or the other way around, is rejected: the two mounts must not alias.
 *
 * lessons/ grep, 2026-10-25 (read-only): 18 wrangler lessons mention /tmp, only as HOME
 * (mkdtemp "/tmp/home-") or as a project cwd ("/tmp/proj", mkdtemp "/tmp/proj-" or "/tmp/p-").
 * Every spawn runs the node binary with a script under /w/node_modules. None exec a file that
 * lives on /tmp. noexec blocks execve of files stored on /tmp or on the /w tmpfs; it does not stop
 * the image's interpreter from reading a script, so those lessons still run. 111 lesson code blocks
 * were checked. Lesson code also creates directories under /w, which is why /w is a tmpfs.
 */

/** Host path of an install result directory, or undefined when that path is not a directory. */
function installResultHostPath(workDir: string, name: "node_modules" | "site"): string | undefined {
  const path = join(workDir, name);
  let real: string;
  try {
    real = realpathSync(path);
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ? (err as { code?: unknown }).code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw err;
  }
  if (!lstatSync(real).isDirectory()) return undefined;
  return path;
}
export function buildDockerRunArgs(opts: DockerRunOptions): string[] {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) throw new Error("Docker options must be an object.");
  for (const key of Object.keys(opts)) {
    if (!ALLOWED_OPTIONS.has(key)) throw new Error(`Unknown docker option ${key}.`);
  }
  const phase = opts.phase;
  if (phase !== "run" && phase !== "install") throw new Error(`Unknown docker phase ${String(phase)}.`);
  if (typeof opts.runtime !== "string") throw new Error("Docker runtime must be a string.");
  if (phase === "run" && opts.packages !== undefined) throw new Error("The run phase does not take packages.");
  if (phase === "run" && opts.installStep !== undefined) throw new Error("The run phase does not take installStep.");
  const installStep = opts.installStep;
  if (phase === "install" && installStep !== "npm-lock" && installStep !== "npm-ci" && installStep !== "pip") {
    throw new Error(`Unknown install step ${String(installStep)}.`);
  }
  // Install keeps the network so npm or pip can run. It must not see the verifier tree.
  if (opts.verifierDeps !== undefined && phase !== "run") throw new Error("verifierDeps is only allowed for the run phase.");
  const name = requireName(opts.name);
  const img = imageFor(opts.runtime);
  if (!img || !PINNED_IMAGE.test(img.image)) throw new Error(`Unknown runtime ${opts.runtime}.`);
  const user = sandboxUser();
  const packages = phase === "install" ? validatedPackages(opts.packages) : [];
  if (phase === "install" && installStep === "pip" && img.language !== "python") throw new Error("pip install requires a python runtime.");
  if (phase === "install" && installStep !== "pip" && img.language !== "node") throw new Error("npm install requires a node runtime.");
  const source = opts.workDir === undefined ? undefined : dockerMountSource(opts.workDir);
  // The install container may see only the files the runner wrote for this step.
  // A lesson file, a credential file, node_modules, or a symlink throws before any argv is returned.
  if (phase === "install" && opts.workDir !== undefined) {
    if (installStep !== "npm-lock" && installStep !== "npm-ci" && installStep !== "pip") {
      throw new Error(`Unknown install step ${String(installStep)}.`);
    }
    assertInstallWorkDirClean(opts.workDir, installStep);
  }
  const verifierSource = opts.verifierDeps === undefined ? undefined : dockerMountSource(opts.verifierDeps, "Verifier deps directory");
  if (opts.workDir !== undefined && opts.verifierDeps !== undefined && (isInside(opts.workDir, opts.verifierDeps) || isInside(opts.verifierDeps, opts.workDir))) {
    throw new Error("verifierDeps and workDir overlap.");
  }

  const args = ["run", "--rm"];
  if (phase === "run") args.push("-i");
  args.push(
    "--name", name,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    "--memory", "512m",
    "--cpus", "1",
    "--pids-limit", "256",
    "--user", user,
  );
  // Phase decides the network. "run" always passes none. "install" adds no network flag at all.
  if (phase === "run") args.push("--network", "none");
  args.push("--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m");
  if (source !== undefined && opts.workDir !== undefined) {
    const workDir = opts.workDir;
    if (phase === "run") {
      // Scratch for lesson writes (mkdir /w/proj). Not a bind, so nothing is written back to the host.
      // `source` is the validated work directory and is intentionally not placed on a -v.
      args.push("--tmpfs", "/w:rw,noexec,nosuid,nodev,size=128m,mode=1777");
      if (img.language === "node") {
        const hostPath = installResultHostPath(workDir, "node_modules");
        if (hostPath !== undefined) {
          const resultSource = dockerMountSource(hostPath, "Node modules directory");
          // `:ro` is a literal. There is no option to make this bind writable.
          args.push("-v", `${resultSource}:/w/node_modules:ro`);
        }
      } else {
        const hostPath = installResultHostPath(workDir, "site");
        if (hostPath !== undefined) {
          const resultSource = dockerMountSource(hostPath, "Site directory");
          args.push("-v", `${resultSource}:/w/site:ro`);
        }
      }
      args.push("-w", "/w");
    } else {
      // Install stays writable so npm and pip can write the tree.
      args.push("-v", `${source}:/w`, "-w", "/w");
    }
    const env = phase === "run" ? RUN_ENV : installStep === "pip" ? PIP_INSTALL_ENV : NPM_INSTALL_ENV;
    for (const pair of env) args.push("-e", pair);
  }
  // Literal `:ro`, and the destination is VERIFIER_STORE_PREFIX without its trailing slash.
  // Callers cannot drop either: neither is read from the options object.
  if (verifierSource !== undefined) {
    // The destination and `:ro` are literals. VERIFIER_STORE_PREFIX is checked so the
    // recorded path and this mount cannot drift apart. Neither is read from the options.
    if (VERIFIER_STORE_PREFIX !== "/verifier/") throw new Error("Verifier store mount must be /verifier.");
    args.push("-v", `${verifierSource}:/verifier:ro`);
  }
  args.push(img.image);
  if (phase === "run") {
    args.push(...img.command);
  } else if (installStep === "npm-lock") {
    // Writes package-lock.json from the host-written package.json. Scripts stay off.
    // The registry resolution here is trust on first use; see the file header.
    args.push("npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error");
  } else if (installStep === "npm-ci") {
    // npm ci refuses a tarball whose integrity does not match the lockfile. Scripts stay off.
    args.push("npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error");
  } else {
    // requirements.txt is written on the host with --hash. Wheels only, so no setup.py runs.
    args.push(
      "pip", "install", "--require-hashes", "--only-binary", ":all:", "--no-cache-dir", "--target", "/w/site",
      "-r", "/w/requirements.txt",
    );
  }
  // Names and versions are checked above. The install command reads package.json or
  // requirements.txt from the work directory, so those names are not copied onto argv.
  void packages;
  return args;
}

const INSTALL_FILES: Record<InstallStep, readonly string[]> = {
  "npm-lock": ["package.json"],
  "npm-ci": ["package.json", "package-lock.json"],
  pip: ["requirements.txt"],
};

/** Directories a previous install step may have created. The lock step has created none. */
const INSTALL_DIRS: Record<InstallStep, readonly string[]> = {
  "npm-lock": [],
  "npm-ci": [".home", ".npm"],
  pip: [],
};

const CREDENTIAL_FILES = new Set([".npmrc", ".pypirc", "pip.conf"]);

/**
 * Host-side check before an install container starts. The work directory may contain
 * only the files the runner wrote for this step, plus directories an earlier install
 * step created. `.npmrc`, `.pypirc`, `pip.conf`, any other file, `node_modules`, and
 * any symlink are rejected. The error names the entry, not the host directory.
 */
export function assertInstallWorkDirClean(dir: string, step: InstallStep): void {
  if (step !== "npm-lock" && step !== "npm-ci" && step !== "pip") throw new Error(`Unknown install step ${String(step)}.`);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    throw new Error("Install work directory is unreadable.");
  }
  const files = new Set(INSTALL_FILES[step]);
  const dirs = new Set(INSTALL_DIRS[step]);
  const seen = new Set<string>();
  for (const name of names) {
    seen.add(name);
    let st: ReturnType<typeof lstatSync>;
    try {
      st = lstatSync(join(dir, name));
    } catch {
      throw new Error("Install work directory is unreadable.");
    }
    if (st.isSymbolicLink()) throw new Error(`Install work directory contains a symlink (${name}).`);
    if (CREDENTIAL_FILES.has(name)) throw new Error(`Install work directory contains ${name}.`);
    if (st.isDirectory()) {
      if (!dirs.has(name)) throw new Error(`Install work directory contains an unexpected directory (${name}).`);
      continue;
    }
    if (st.isFile()) {
      if (!files.has(name)) throw new Error(`Install work directory contains an unexpected file (${name}).`);
      continue;
    }
    throw new Error(`Install work directory contains an unexpected entry (${name}).`);
  }
  for (const required of files) {
    if (!seen.has(required)) throw new Error(`Install work directory is missing ${required}.`);
  }
}

function rejectNonRegistrySpec(spec: unknown, where: string): void {
  if (typeof spec !== "string") throw new Error(`npm lockfile spec at ${where} is not a string.`);
  if (NON_REGISTRY_SPEC.test(spec) && !spec.startsWith(REGISTRY_TARBALL)) {
    throw new Error(`npm lockfile spec at ${where} is not from the npm registry.`);
  }
}

function scanDependencyMap(map: unknown, where: string): void {
  if (map === undefined) return;
  if (typeof map !== "object" || map === null || Array.isArray(map)) throw new Error(`npm lockfile ${where} is not an object.`);
  for (const [name, spec] of Object.entries(map as Record<string, unknown>)) rejectNonRegistrySpec(spec, `${where} ${name}`);
}

/** npm lockfileVersion 2 still nests a `dependencies` tree of objects. Version 3 usually omits it. */
function walkLegacyDependencies(node: unknown, where: string): void {
  if (typeof node !== "object" || node === null || Array.isArray(node)) throw new Error(`npm lockfile ${where} is not an object.`);
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    if (typeof value === "string") {
      rejectNonRegistrySpec(value, `${where} ${name}`);
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`npm lockfile ${where} ${name} is not a package.`);
    const entry = value as Record<string, unknown>;
    if (typeof entry.version === "string") rejectNonRegistrySpec(entry.version, `${where} ${name} version`);
    if (typeof entry.resolved === "string" && !entry.resolved.startsWith(REGISTRY_TARBALL)) {
      throw new Error(`npm lockfile ${where} ${name} is not resolved from the npm registry.`);
    }
    if (entry.dependencies !== undefined) walkLegacyDependencies(entry.dependencies, `${where} ${name} dependencies`);
  }
}

/**
 * Host check between the lock container and `npm ci`. Trust on first use: the lockfile
 * was just resolved from the registry. Reject it unless every non-root package is a
 * registry tarball with sha512 integrity, and each pinned package is present at that exact version.
 */
export function checkNpmLockfile(lockJson: unknown, pinnedPackages: Record<string, string>): void {
  if (typeof lockJson !== "object" || lockJson === null || Array.isArray(lockJson)) throw new Error("npm lockfile is not an object.");
  const lock = lockJson as Record<string, unknown>;
  if (typeof lock.lockfileVersion !== "number" || !Number.isFinite(lock.lockfileVersion) || lock.lockfileVersion < 2) {
    throw new Error("npm lockfileVersion must be >= 2.");
  }
  if (typeof lock.packages !== "object" || lock.packages === null || Array.isArray(lock.packages)) {
    throw new Error("npm lockfile has no packages object.");
  }
  const packages = lock.packages as Record<string, unknown>;
  const pins = validatedPackages(pinnedPackages);
  for (const [key, value] of Object.entries(packages)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`npm lockfile package ${key} is not an object.`);
    const entry = value as Record<string, unknown>;
    for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
      scanDependencyMap(entry[field], `${key} ${field}`);
    }
    if (key === "") continue;
    if (entry.link === true) throw new Error(`npm lockfile package ${key} is a link.`);
    if (typeof entry.integrity !== "string" || !entry.integrity.startsWith("sha512-")) {
      throw new Error(`npm lockfile package ${key} has no sha512 integrity.`);
    }
    if (typeof entry.resolved !== "string" || !entry.resolved.startsWith(REGISTRY_TARBALL)) {
      throw new Error(`npm lockfile package ${key} is not resolved from the npm registry.`);
    }
    if (typeof entry.version === "string") rejectNonRegistrySpec(entry.version, `${key} version`);
  }
  if (lock.dependencies !== undefined) walkLegacyDependencies(lock.dependencies, "dependencies");
  for (const [name, version] of pins) {
    const key = `node_modules/${name}`;
    const entry = packages[key];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`npm lockfile is missing ${key}.`);
    if ((entry as Record<string, unknown>).version !== version) throw new Error(`npm lockfile ${key} version is not ${version}.`);
  }
}

/**
 * `requirements.txt` body for `pip install --require-hashes`. Each pin needs
 * `sha256:` and 64 lowercase hex digits. A missing or invalid hash is rejected.
 * Lessons do not carry hashes, so `runInDocker` does not call this.
 */
export function buildRequirementsTxt(pins: readonly { name: string; version: string; hash?: string }[]): string {
  if (!Array.isArray(pins)) throw new Error("pip pins must be a list.");
  if (pins.length === 0) throw new Error("pip requirements are empty.");
  const lines: string[] = [];
  for (const pin of pins) {
    if (typeof pin !== "object" || pin === null) throw new Error("pip pin is not an object.");
    if (typeof pin.name !== "string" || typeof pin.version !== "string" || !PACKAGE_NAME.test(pin.name) || !PACKAGE_VERSION.test(pin.version)) {
      throw new Error(`Package ${String(pin.name)}@${String(pin.version)} is not an exact name and version.`);
    }
    if (typeof pin.hash !== "string" || !SHA256_HASH.test(pin.hash)) throw new Error(`pip pin ${pin.name} needs --hash=sha256:<64 hex>.`);
    lines.push(`${pin.name}==${pin.version} --hash=${pin.hash}`);
  }
  return `${lines.join("\n")}\n`;
}

/** `docker run` arguments for the lesson code. Code is passed on stdin. Phase is always "run". */
export function dockerArgs(runtime: string, name: string, workDir?: string): string[] {
  return buildDockerRunArgs(workDir === undefined
    ? { phase: "run", runtime, name }
    : { phase: "run", runtime, name, workDir });
}

/** `docker run` arguments for one install step: network on, scripts disabled, no lesson code. */
export function installArgs(
  runtime: string,
  workDir: string,
  packages: Record<string, string>,
  step: InstallStep,
  name = `ludion-install-${crypto.randomUUID()}`,
): string[] {
  return buildDockerRunArgs({ phase: "install", runtime, name, workDir, packages, installStep: step });
}

function failureReason(err: unknown, fallback: string): string {
  return err instanceof Error && err.message.length > 0 ? err.message : fallback;
}

function run(args: string[], stdin: string | undefined, timeoutMs: number, name?: string): Promise<RawRun> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (name) spawn("docker", ["kill", name], { stdio: "ignore" });
      else child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { if (stdout.length < 1_000_000) stdout += d; });
    child.stderr.on("data", (d: Buffer) => { if (stderr.length < 1_000_000) stderr += d; });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ kind: "error", reason: `Could not start Docker (${err.message}). Install Docker, or run without --run.` });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ kind: "done", exitCode, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(stdin ?? "");
  });
}

export const runInDocker: RunFn = async (spec) => {
  const img = imageFor(spec.runtime);
  if (!img) return { kind: "error", reason: `Unknown runtime ${spec.runtime}. Use one from lessons/lessons.schema.json.` };
  const packages = spec.packages && Object.keys(spec.packages).length ? spec.packages : undefined;
  const name = `ludion-verify-${crypto.randomUUID()}`;
  if (!packages) return run(dockerArgs(spec.runtime, name), spec.code, TIMEOUT_MS, name);

  // Lessons carry a name and a version, never a hash, and there is no trusted hash source.
  // Do not start pip, and do not drop --require-hashes.
  if (img.language !== "node") {
    return { kind: "error", reason: "pip install needs --require-hashes; the lesson gives no hashes" };
  }

  const workDir = mkdtempSync(join(tmpdir(), "ludion-test-"));
  try {
    prepareSandboxWorkDir(workDir);
    const dependencies: Record<string, string> = {};
    for (const [pkg, version] of Object.entries(packages).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) dependencies[pkg] = version;
    writeFileSync(join(workDir, "package.json"), JSON.stringify({ private: true, dependencies }));
    const label = Object.entries(dependencies).map(([pkg, version]) => `${pkg}@${version}`).join(", ");
    const installFailed = (raw: RawRun): RawRun | undefined => {
      if (raw.kind === "error") return raw;
      if (raw.timedOut || raw.exitCode !== 0) {
        const tail = (raw.stderr || raw.stdout).trim().slice(-OUTPUT_LIMIT);
        return { kind: "error", reason: `Could not install ${label}.${tail ? `\n${tail}` : ""}` };
      }
      return undefined;
    };

    try {
      assertInstallWorkDirClean(workDir, "npm-lock");
    } catch (err) {
      return { kind: "error", reason: failureReason(err, "Install work directory is not clean.") };
    }
    const lockName = `ludion-install-${crypto.randomUUID()}`;
    const locked = await run(installArgs(spec.runtime, workDir, packages, "npm-lock", lockName), undefined, INSTALL_TIMEOUT_MS, lockName);
    const lockFailure = installFailed(locked);
    if (lockFailure) return lockFailure;

    let lockJson: unknown;
    try {
      lockJson = JSON.parse(readFileSync(join(workDir, "package-lock.json"), "utf8")) as unknown;
    } catch {
      return { kind: "error", reason: "npm lockfile is unreadable." };
    }
    try {
      checkNpmLockfile(lockJson, packages);
      assertInstallWorkDirClean(workDir, "npm-ci");
    } catch (err) {
      return { kind: "error", reason: failureReason(err, "npm lockfile was rejected.") };
    }
    const ciName = `ludion-install-${crypto.randomUUID()}`;
    const installed = await run(installArgs(spec.runtime, workDir, packages, "npm-ci", ciName), undefined, INSTALL_TIMEOUT_MS, ciName);
    const ciFailure = installFailed(installed);
    if (ciFailure) return ciFailure;
    return await run(dockerArgs(spec.runtime, name, workDir), spec.code, TIMEOUT_WITH_PACKAGES_MS, name);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
};

export type RunResult = { status: "passed" } | { status: "skipped"; reason: string } | { status: "failed"; reason: string };

const tailOf = (r: { stdout: string; stderr: string }) => (r.stderr || r.stdout).trim().slice(-OUTPUT_LIMIT);

/**
 * What a finished run means. expect pass: exit 0 passes, unless stdout has a line starting "skip:".
 * expect fail: it must exit non-zero, and its output must contain `error`, so it fails for the reason the lesson names.
 */
export function interpretRun(raw: RawRun, expect: "pass" | "fail" = "pass", error?: string): RunResult {
  if (raw.kind === "error") return { status: "failed", reason: raw.reason };
  if (raw.timedOut) return { status: "failed", reason: "The test ran too long (30 seconds, or 90 with packages). Make it finish faster and work offline." };
  if (expect === "fail") {
    if (raw.exitCode === 0) return { status: "failed", reason: `The test was expected to fail with "${error}", but it exited 0.` };
    const output = `${raw.stdout}\n${raw.stderr}`;
    if (error && output.includes(error)) return { status: "passed" };
    const tail = tailOf(raw);
    return { status: "failed", reason: `The test failed, but its output does not contain "${error}". It must fail for the reason the lesson names.${tail ? `\n${tail}` : ""}` };
  }
  if (raw.exitCode === 0) {
    const skip = raw.stdout.split(/\r?\n/).find((line) => line.startsWith("skip:"));
    return skip ? { status: "skipped", reason: skip } : { status: "passed" };
  }
  const tail = tailOf(raw);
  return { status: "failed", reason: `The test exited with code ${raw.exitCode}, so the fact did not hold.${tail ? `\n${tail}` : ""}` };
}
