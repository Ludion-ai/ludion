// Entry points the P1 Capability runner will call later. Nothing on main runs
// vitest yet: lesson code still goes through the Docker runner. These functions
// only describe an isolated vitest install (where it lives, which binary loaded,
// and whether that install sits inside the recipient tree).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * In-container mount of the verifier install. The same prefix is in the schema
 * commit 078f89d6254d1428e95c973bffacf7b474f47ac8. That package is not imported.
 * The recorded vitest path is this prefix plus the path under the store, using
 * forward slashes. The host realpath is checked, then dropped.
 */
export const VERIFIER_STORE_PREFIX = "/verifier/" as const;

/**
 * Validators copied from packages/capability/src/schema.ts at
 * 078f89d6254d1428e95c973bffacf7b474f47ac8 (VerifierRuntime, FullSemver, isVerifierRealpath).
 * That file is not imported: this branch does not take a dependency on it.
 */
const FULL_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const INTEGRITY_SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RUNTIME_KEYS = ["vitest_location", "vitest_realpath", "vitest_version", "vitest_integrity", "lockfile_sha256"] as const;

/** Fixed strings that may be stored in results.json. Filesystem errors are not. */
const PUBLIC_ERRORS = new Set([
  "not_isolated",
  "lockfile_git_blob_unreadable",
  "lockfile_sha256_missing",
  "lockfile_sha256_mismatch",
  "vitest_integrity_missing",
  "verifier_runtime_invalid",
  "vitest_unreadable",
]);

export interface IsolationCheck {
  isolated: boolean;
  reason?: string;
}

/**
 * `verifier_runtime` as published at 078f89d6254d1428e95c973bffacf7b474f47ac8.
 * Strict: these keys and no others. No host path.
 */
export interface VerifierRuntime {
  vitest_location: "verifier_store";
  vitest_realpath: string;
  vitest_version: string;
  vitest_integrity: string;
  lockfile_sha256: string;
}

export interface VerifierProvenanceReport {
  node_version: string;
  isolation: IsolationCheck;
  trusted: boolean;
  verifier_runtime: VerifierRuntime | null;
  /** Fixed code. Present only when `trusted` is false. */
  unavailable_reason?: string;
}

/**
 * Absolute path with symlinks resolved where the path exists.
 * Missing suffixes keep their lexical tail on the realpath of the nearest existing ancestor,
 * so a not-yet-created child still compares against the directory it will live in.
 */
function canonicalPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) throw new Error("Path must be a non-empty string.");
  let current = resolve(input);
  const rest: string[] = [];
  for (;;) {
    try {
      let out = realpathSync(current);
      for (const part of rest) {
        if (part === "" || part === ".") continue;
        out = part === ".." ? dirname(out) : join(out, part);
      }
      return out;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // A missing tail, or a non-directory in the middle, is walked. Anything else is real.
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = dirname(current);
      if (parent === current) throw err;
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

/**
 * True when `child` is `parent` or a path inside it.
 * Both sides are resolved to absolute paths and realpath'd where they exist.
 * Comparison is case-insensitive on win32. A prefix such as `repo` versus `repo-other` is not containment.
 */
export function isInside(child: string, parent: string): boolean {
  const childPath = pathKey(canonicalPath(child));
  const parentPath = pathKey(canonicalPath(parent));
  if (childPath === parentPath) return true;
  const prefix = parentPath.endsWith(sep) ? parentPath : parentPath + sep;
  return childPath.startsWith(prefix);
}

/**
 * Repo root of the loaded tools/verify. A module at `tools/verify/src/<file>` is three
 * directories below that root: src -> verify -> tools -> root.
 */
export function verifierRootFromModule(moduleUrl: string | URL): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), "..", "..", "..");
}

/**
 * Dedicated install directory, outside the recipient tree. `lockfileSha256Hex` is 64 lowercase hex
 * characters (no `sha256:` prefix). The directory name keeps the first 16 so a human can see which
 * lockfile was installed without pasting the whole digest into a path.
 */
export function verifierDepsDir(lockfileSha256Hex: string, baseDir: string): string {
  if (typeof lockfileSha256Hex !== "string" || !SHA256_HEX.test(lockfileSha256Hex)) {
    throw new Error("Lockfile sha256 must be 64 lowercase hex characters.");
  }
  if (typeof baseDir !== "string" || baseDir.length === 0) throw new Error("baseDir must be a directory path.");
  return join(baseDir, `ludion-verifier-deps-${lockfileSha256Hex.slice(0, 16)}`);
}

/** `npm ci` for that directory. Scripts, audit, and fund are off. The argument list is closed. */
export function buildVerifierDepsInstall(depsDir: string): {
  command: "npm";
  args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  cwd: string;
} {
  if (typeof depsDir !== "string" || depsDir.length === 0) throw new Error("depsDir must be a directory path.");
  return {
    command: "npm",
    args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    cwd: depsDir,
  };
}

/**
 * Isolated only when neither directory contains the other. The current CI layout
 * (`<recipient>/.verifier`) fails this: the install lives inside the tree it judges.
 */
export function checkVerifierIsolation(input: { depsDir: string; recipientRoot: string }): IsolationCheck {
  if (isInside(input.depsDir, input.recipientRoot)) {
    return { isolated: false, reason: "Verifier deps directory is inside the recipient tree." };
  }
  if (isInside(input.recipientRoot, input.depsDir)) {
    return { isolated: false, reason: "Recipient tree is inside the verifier deps directory." };
  }
  return { isolated: true };
}

export function assertVerifierIsolation(input: { depsDir: string; recipientRoot: string }): void {
  const result = checkVerifierIsolation(input);
  if (!result.isolated) throw new Error(`Verifier deps are not isolated: ${result.reason}`);
}

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`${what} is unreadable.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${what} is not valid JSON.`);
  }
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${what} is not an object.`);
  return value as Record<string, unknown>;
}

function realpathInside(path: string, root: string, what: string): string {
  let real: string;
  try {
    real = realpathSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`${what} is not installed in the verifier deps directory.`);
    throw new Error(`${what} is unreadable.`);
  }
  // A symlink or junction whose target leaves the install (for example into the recipient
  // tree) must not count as the loaded vitest. realpath follows the link; containment does not.
  if (!isInside(real, root)) throw new Error(`${what} resolves outside the verifier deps directory.`);
  return real;
}

function vitestBinRelative(pkg: Record<string, unknown>): string {
  const bin = pkg.bin;
  if (typeof bin === "string" && bin.length > 0) return bin;
  if (typeof bin === "object" && bin !== null && !Array.isArray(bin)) {
    const entry = (bin as Record<string, unknown>).vitest;
    if (typeof entry === "string" && entry.length > 0) return entry;
  }
  throw new Error("vitest package.json has no vitest bin entry.");
}

/** Same checks as isVerifierRealpath at 078f89d6254d1428e95c973bffacf7b474f47ac8. */
function isVerifierRealpath(p: string): boolean {
  if (!p.startsWith(VERIFIER_STORE_PREFIX)) return false;
  // A file under the store: at least one segment after the prefix, no empty segment, no trailing slash.
  const rest = p.slice(VERIFIER_STORE_PREFIX.length);
  if (rest.length === 0 || rest.endsWith("/")) return false;
  if (rest.split("/").some((s) => s.length === 0)) return false;
  if (!p.isWellFormed()) return false;
  if (p.includes("\\") || p.includes("%") || p.includes("//")) return false;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  for (const s of p.split("/")) {
    if (s === "." || s === "..") return false;
  }
  return true;
}

/**
 * Returns a reason when `value` is not the published VerifierRuntime object, otherwise null.
 * Reasons name the field. They do not echo the value.
 */
export function validateVerifierRuntime(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "verifier_runtime is not an object";
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== RUNTIME_KEYS.length || RUNTIME_KEYS.some((key) => !Object.hasOwn(record, key))) return "verifier_runtime keys";
  if (record.vitest_location !== "verifier_store") return "vitest_location";
  if (typeof record.vitest_realpath !== "string" || record.vitest_realpath.length > 400 || !isVerifierRealpath(record.vitest_realpath)) return "vitest_realpath";
  if (typeof record.vitest_version !== "string" || record.vitest_version.length > 128 || !FULL_SEMVER.test(record.vitest_version)) return "vitest_version";
  if (typeof record.vitest_integrity !== "string" || !INTEGRITY_SHA512.test(record.vitest_integrity)) return "vitest_integrity";
  if (typeof record.lockfile_sha256 !== "string" || !SHA256_HEX.test(record.lockfile_sha256)) return "lockfile_sha256";
  return null;
}

/**
 * sha256 of `HEAD:package-lock.json` in `verifierRoot`. The git argv is an array and the
 * shell is off, so a lockfile path cannot become a command. The thrown message is a fixed
 * code: git's own message can contain a host path.
 */
export function lockfileSha256AtHead(verifierRoot: string): string {
  if (typeof verifierRoot !== "string" || verifierRoot.length === 0) throw new Error("lockfile_git_blob_unreadable");
  try {
    const blob = execFileSync("git", ["-C", verifierRoot, "show", "HEAD:package-lock.json"], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return createHash("sha256").update(blob).digest("hex");
  } catch {
    throw new Error("lockfile_git_blob_unreadable");
  }
}

/**
 * The vitest that is actually on disk in `depsDir`, not the copy in the recipient tree
 * and not the version named in a config file. The package directory and the bin entry
 * must both realpath to files inside `depsDir`. The host realpath is used for that check
 * and is not returned. `expectedLockfileSha256` is the 64 hex digits of the base lockfile
 * (no `sha256:` prefix). A different file on disk, including a dirty working tree, fails
 * with `lockfile_sha256_mismatch`.
 */
export function resolveLoadedVitest(depsDir: string, expectedLockfileSha256: string): VerifierRuntime {
  if (typeof depsDir !== "string" || depsDir.length === 0) throw new Error("depsDir must be a directory path.");
  if (typeof expectedLockfileSha256 !== "string" || !SHA256_HEX.test(expectedLockfileSha256)) {
    throw new Error("lockfile_sha256_mismatch");
  }
  let installRoot: string;
  try {
    const st = lstatSync(depsDir);
    if (!st.isDirectory() && !st.isSymbolicLink()) throw new Error("depsDir must be a directory.");
    installRoot = realpathSync(depsDir);
  } catch (err) {
    if (err instanceof Error && err.message === "depsDir must be a directory.") throw err;
    throw new Error("Verifier deps directory does not exist.");
  }

  const pkgReal = realpathInside(join(depsDir, "node_modules", "vitest", "package.json"), installRoot, "vitest package.json");
  const pkg = asRecord(readJson(pkgReal, "vitest package.json"), "vitest package.json");
  const version = pkg.version;
  if (typeof version !== "string" || version.length > 128 || !FULL_SEMVER.test(version)) {
    throw new Error(`Loaded vitest version ${JSON.stringify(version)} is not SemVer 2.0.`);
  }

  const binReal = realpathInside(resolve(dirname(pkgReal), vitestBinRelative(pkg)), installRoot, "vitest bin");
  const vitestRelpath = relative(installRoot, binReal).split(sep).join("/");
  if (vitestRelpath === "" || vitestRelpath.startsWith("../") || vitestRelpath === ".." || vitestRelpath.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("vitest bin resolves outside the verifier deps directory.");
  }

  const lockReal = realpathInside(join(depsDir, "package-lock.json"), installRoot, "package-lock.json");
  let lockBytes: Buffer;
  try {
    lockBytes = readFileSync(lockReal);
  } catch {
    throw new Error("package-lock.json is unreadable.");
  }
  const lockfileSha256 = createHash("sha256").update(lockBytes).digest("hex");
  if (lockfileSha256 !== expectedLockfileSha256) throw new Error("lockfile_sha256_mismatch");
  let parsed: unknown;
  try {
    parsed = JSON.parse(lockBytes.toString("utf8")) as unknown;
  } catch {
    throw new Error("package-lock.json is not valid JSON.");
  }
  const lock = asRecord(parsed, "package-lock.json");
  const packages = asRecord(lock.packages, "package-lock.json packages");
  const entry = packages["node_modules/vitest"];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new Error("Installed vitest does not match the lockfile (node_modules/vitest entry is missing). The installed tree does not match the lockfile.");
  }
  const locked = entry as Record<string, unknown>;
  if (locked.version !== version) {
    throw new Error(
      `Installed vitest ${version} does not match the lockfile version ${JSON.stringify(locked.version)}. The installed tree does not match the lockfile.`,
    );
  }
  if (typeof locked.integrity !== "string" || locked.integrity.length === 0) throw new Error("vitest_integrity_missing");
  const runtime: VerifierRuntime = {
    vitest_location: "verifier_store",
    vitest_realpath: `${VERIFIER_STORE_PREFIX}${vitestRelpath}`,
    vitest_version: version,
    vitest_integrity: locked.integrity,
    lockfile_sha256: lockfileSha256,
  };
  if (validateVerifierRuntime(runtime)) throw new Error("verifier_runtime_invalid");
  return runtime;
}

function publicError(err: unknown): string {
  if (err instanceof Error && PUBLIC_ERRORS.has(err.message)) return err.message;
  return "vitest_unreadable";
}

/**
 * What results.json may say about the verifier. When the install is not isolated from the
 * recipient, the loaded vitest is not trusted and is not recorded. When it is isolated,
 * `verifier_runtime` is the in-container path plus the lockfile hash. Filesystem errors
 * become `vitest_unreadable`. No host path is returned.
 */
export function verifierProvenance(input: {
  verifierRoot: string;
  recipientRoot: string;
  nodeVersion: string;
  /** 64 lowercase hex digits of the base lockfile. Required when isolation holds. */
  expectedLockfileSha256?: string;
  /** Set when `git show HEAD:package-lock.json` failed. A fixed code. */
  lockfileError?: "lockfile_git_blob_unreadable";
}): VerifierProvenanceReport {
  if (typeof input.nodeVersion !== "string" || input.nodeVersion.length === 0) {
    throw new Error("nodeVersion must be a non-empty string.");
  }
  const isolation = checkVerifierIsolation({ depsDir: input.verifierRoot, recipientRoot: input.recipientRoot });
  if (!isolation.isolated) {
    return {
      node_version: input.nodeVersion,
      isolation,
      trusted: false,
      verifier_runtime: null,
      unavailable_reason: "not_isolated",
    };
  }
  if (input.lockfileError !== undefined) {
    return {
      node_version: input.nodeVersion,
      isolation,
      trusted: false,
      verifier_runtime: null,
      unavailable_reason: "lockfile_git_blob_unreadable",
    };
  }
  if (input.expectedLockfileSha256 === undefined) {
    return {
      node_version: input.nodeVersion,
      isolation,
      trusted: false,
      verifier_runtime: null,
      unavailable_reason: "lockfile_sha256_missing",
    };
  }
  try {
    return {
      node_version: input.nodeVersion,
      isolation,
      trusted: true,
      verifier_runtime: resolveLoadedVitest(input.verifierRoot, input.expectedLockfileSha256),
    };
  } catch (err) {
    return {
      node_version: input.nodeVersion,
      isolation,
      trusted: false,
      verifier_runtime: null,
      unavailable_reason: publicError(err),
    };
  }
}
