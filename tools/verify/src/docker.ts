// Runs lesson test code in Docker with the network off (CLAUDE.md, "Lesson code runs only in Docker with the
// network off"). A test that pins package versions is run in two steps: first the packages are installed in a
// container with the network on, install scripts off, and no lesson code; then the lesson code runs in a fresh
// container with the network off, against those installed packages.
//
// Every `docker run` argument list is built by buildDockerRunArgs. The hardening flags are added there and
// are not caller options, so a caller cannot drop them. The only host input is the process uid/gid, read
// inside that function, and it is never taken from the options object.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isInside } from "./verifier-deps.ts";

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
const ALLOWED_OPTIONS = new Set(["phase", "runtime", "name", "workDir", "packages", "verifierDeps"]);

function requireName(name: string): string {
  if (typeof name !== "string" || !CONTAINER_NAME.test(name)) {
    throw new Error(`Container name ${JSON.stringify(name)} is not a single safe token.`);
  }
  return name;
}

/**
 * Absolute host path safe to place before `:` in a bind mount. A comma or an extra colon would be
 * read by Docker as mount options (`-v host,opt:/w` or `-v host:/etc:ro`). A Windows drive prefix is
 * rewritten to `/c/...` so the value that is actually passed has no colon; any other colon is rejected.
 * `what` is only the noun in the error text. Work directories and the verifier deps directory share this check.
 */
export function dockerMountSource(workDir: string, what = "Work directory"): string {
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
  /** Absolute host directory bind-mounted at /w. Optional for a run with no packages. */
  workDir?: string;
  /**
   * Absolute host directory of the isolated verifier install, bind-mounted at /verifier.
   * Run phase only. The mount is always read-only (`:ro`); there is no field to drop that.
   */
  verifierDeps?: string;
  /** Exact package versions. Install phase only. They are not lesson code. */
  packages?: Record<string, string>;
}

/**
 * The only builder of `docker run` arguments. Hardening flags are unconditional.
 *
 * Network is a property of the phase, not a caller option:
 * - phase "run" executes lesson code and ALWAYS sets the network to none;
 * - phase "install" is the only phase that keeps Docker's default network. It runs npm or pip with
 *   install scripts disabled and no lesson code, so it can reach a registry.
 *
 * The only tmpfs is /tmp (rw, noexec, nosuid, nodev, 64m). The run phase sets HOME=/tmp when a work
 * folder is mounted, and lessons use /tmp as scratch. The install phase writes the tree, HOME
 * (/w/.home), the npm cache (/w/.npm), and the pip target (/w/site) on the bind mount, but pip and
 * npm still unpack through the system temp directory, which a read-only root would make immutable.
 * No tmpfs is added for /var, /run, or /home.
 *
 * When `verifierDeps` is set on a run, it is mounted at /verifier with `:ro` appended by this
 * function. The option is rejected for the install phase. A verifier deps directory that contains
 * the work directory, or the other way around, is rejected: the two mounts must not alias.
 *
 * lessons/ grep, 2026-10-25 (read-only): 18 wrangler lessons mention /tmp, only as HOME
 * (mkdtemp "/tmp/home-") or as a project cwd ("/tmp/proj", mkdtemp "/tmp/proj-" or "/tmp/p-").
 * Every spawn runs the node binary with a script under /w/node_modules. None exec a file that
 * lives on /tmp. noexec blocks execve of files stored on this mount; it does not stop the image's
 * interpreter from reading a script, so those lessons still run. 111 lesson code blocks were checked.
 */
export function buildDockerRunArgs(opts: DockerRunOptions): string[] {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) throw new Error("Docker options must be an object.");
  for (const key of Object.keys(opts)) {
    if (!ALLOWED_OPTIONS.has(key)) throw new Error(`Unknown docker option ${key}.`);
  }
  const phase = opts.phase;
  if (phase !== "run" && phase !== "install") throw new Error(`Unknown docker phase ${String(phase)}.`);
  if (typeof opts.runtime !== "string") throw new Error("Docker runtime must be a string.");
  if (phase === "run" && opts.packages !== undefined) throw new Error("The run phase does not take packages.");
  // Install keeps the network so npm or pip can run. It must not see the verifier tree.
  if (opts.verifierDeps !== undefined && phase !== "run") throw new Error("verifierDeps is only allowed for the run phase.");
  const name = requireName(opts.name);
  const img = imageFor(opts.runtime);
  if (!img || !PINNED_IMAGE.test(img.image)) throw new Error(`Unknown runtime ${opts.runtime}.`);
  const user = sandboxUser();
  const packages = phase === "install" ? validatedPackages(opts.packages) : [];
  const source = opts.workDir === undefined ? undefined : dockerMountSource(opts.workDir);
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
  if (source !== undefined) {
    args.push("-v", `${source}:/w`, "-w", "/w");
    if (phase === "run") {
      args.push("-e", "HOME=/tmp", "-e", "NODE_PATH=/w/node_modules", "-e", "PYTHONPATH=/w/site", "-e", "LUDION_PACKAGES=/w");
    } else {
      args.push("-e", "HOME=/w/.home", "-e", "npm_config_cache=/w/.npm");
    }
  }
  // Literal `:ro`. Callers cannot drop it: it is not read from the options object.
  if (verifierSource !== undefined) args.push("-v", `${verifierSource}:/verifier:ro`);
  args.push(img.image);
  if (phase === "run") {
    args.push(...img.command);
  } else if (img.language === "node") {
    // package.json is written on the host. npm installs from it; lesson code is not an argument.
    args.push("npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error");
  } else {
    args.push(
      "pip", "install", "--no-cache-dir", "--only-binary", ":all:", "--target", "/w/site",
      ...packages.map(([packageName, version]) => `${packageName}==${version}`),
    );
  }
  return args;
}

/** `docker run` arguments for the lesson code. Code is passed on stdin. Phase is always "run". */
export function dockerArgs(runtime: string, name: string, workDir?: string): string[] {
  return buildDockerRunArgs(workDir === undefined
    ? { phase: "run", runtime, name }
    : { phase: "run", runtime, name, workDir });
}

/** `docker run` arguments for installing a test's packages: network on, no install scripts, no lesson code. */
export function installArgs(runtime: string, workDir: string, packages: Record<string, string>, name = `ludion-install-${crypto.randomUUID()}`): string[] {
  return buildDockerRunArgs({ phase: "install", runtime, name, workDir, packages });
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

  const workDir = mkdtempSync(join(tmpdir(), "ludion-test-"));
  try {
    prepareSandboxWorkDir(workDir);
    if (img.language === "node") writeFileSync(join(workDir, "package.json"), JSON.stringify({ private: true, dependencies: packages }));
    const installName = `ludion-install-${crypto.randomUUID()}`;
    const install = await run(installArgs(spec.runtime, workDir, packages, installName), undefined, INSTALL_TIMEOUT_MS, installName);
    if (install.kind === "error") return install;
    if (install.timedOut || install.exitCode !== 0) {
      const tail = (install.stderr || install.stdout).trim().slice(-OUTPUT_LIMIT);
      return { kind: "error", reason: `Could not install ${Object.entries(packages).map(([n, v]) => `${n}@${v}`).join(", ")}.${tail ? `\n${tail}` : ""}` };
    }
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
