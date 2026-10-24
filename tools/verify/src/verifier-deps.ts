// Entry points the P1 Capability runner will call later. Nothing on main runs
// vitest yet: lesson code still goes through the Docker runner. These functions
// only describe an isolated vitest install (where it lives, which binary loaded,
// and whether that install sits inside the recipient tree).
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** npm's stable version shape. Prereleases and build metadata are rejected. */
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface IsolationCheck {
  isolated: boolean;
  reason?: string;
}

/** Superset of the loaded vitest install. `toP1VerifierRuntime` maps it onto today's P1 field. */
export interface LoadedVitest {
  /** realpath of the dedicated install directory. */
  install_root: string;
  /** Posix path of the vitest bin entry relative to install_root. */
  vitest_relpath: string;
  /** Absolute realpath of that bin entry. */
  vitest_realpath: string;
  vitest_version: string;
  /** packages["node_modules/vitest"].integrity from the install's package-lock.json. */
  integrity: string | null;
  /** sha256 of the lockfile bytes, prefixed with "sha256:". */
  lockfile_sha256: string;
}

export interface VerifierProvenanceReport {
  node_version: string;
  isolation: IsolationCheck;
  loaded_vitest: LoadedVitest | null;
  loaded_vitest_error?: string;
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
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error(`${what} is missing.`);
    throw err;
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
    throw err;
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

/**
 * The vitest that is actually on disk in `depsDir`, not the copy in the recipient tree
 * and not the version named in a config file. The package directory and the bin entry
 * must both realpath to files inside `depsDir`. The lockfile version must equal the
 * version in that package.json, so a swapped install cannot keep a matching hash of a
 * different tree.
 */
export function resolveLoadedVitest(depsDir: string): LoadedVitest {
  if (typeof depsDir !== "string" || depsDir.length === 0) throw new Error("depsDir must be a directory path.");
  let installRoot: string;
  try {
    const st = lstatSync(depsDir);
    if (!st.isDirectory() && !st.isSymbolicLink()) throw new Error("depsDir must be a directory.");
    installRoot = realpathSync(depsDir);
  } catch (err) {
    if (err instanceof Error && err.message === "depsDir must be a directory.") throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("Verifier deps directory does not exist.");
    throw err;
  }

  const pkgReal = realpathInside(join(depsDir, "node_modules", "vitest", "package.json"), installRoot, "vitest package.json");
  const pkg = asRecord(readJson(pkgReal, "vitest package.json"), "vitest package.json");
  const version = pkg.version;
  if (typeof version !== "string" || !STABLE_VERSION.test(version)) {
    throw new Error(`Loaded vitest version ${JSON.stringify(version)} is not a stable x.y.z version.`);
  }

  const binReal = realpathInside(resolve(dirname(pkgReal), vitestBinRelative(pkg)), installRoot, "vitest bin");
  const vitestRelpath = relative(installRoot, binReal).split(sep).join("/");
  if (vitestRelpath === "" || vitestRelpath.startsWith("../") || vitestRelpath === "..") {
    throw new Error("vitest bin resolves outside the verifier deps directory.");
  }

  const lockReal = realpathInside(join(depsDir, "package-lock.json"), installRoot, "package-lock.json");
  const lockBytes = readFileSync(lockReal);
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
  const integrity = typeof locked.integrity === "string" ? locked.integrity : null;
  return {
    install_root: installRoot,
    vitest_relpath: vitestRelpath,
    vitest_realpath: binReal,
    vitest_version: version,
    integrity,
    lockfile_sha256: `sha256:${createHash("sha256").update(lockBytes).digest("hex")}`,
  };
}

/**
 * Map a loaded-vitest record onto the current P1 `verifier_runtime` shape
 * (`vitest_version` plus absolute `vitest_path`, maxLength 260).
 * Final mapping is pending 開発部長's schema change: an indicator of where vitest
 * was installed, plus a path relative to that dedicated location.
 */
export function toP1VerifierRuntime(rec: LoadedVitest): { vitest_version: string; vitest_path: string } {
  if (typeof rec.vitest_version !== "string" || !STABLE_VERSION.test(rec.vitest_version)) {
    throw new Error(`vitest_version ${JSON.stringify(rec.vitest_version)} is not a stable x.y.z version.`);
  }
  if (typeof rec.vitest_realpath !== "string" || rec.vitest_realpath.length === 0) {
    throw new Error("vitest_path must be a non-empty path.");
  }
  if (rec.vitest_realpath.length > 260) {
    throw new Error(`vitest_path exceeds 260 characters (${rec.vitest_realpath.length}).`);
  }
  return { vitest_version: rec.vitest_version, vitest_path: rec.vitest_realpath };
}

/**
 * What the loaded verifier can say about itself. `loaded_vitest` is read from `verifierRoot`
 * (today that is the checkout that holds node_modules; the runner will later point this at
 * the isolated deps directory). A failure to read vitest is reported, not thrown: results.json
 * still has to be written. Pure apart from those filesystem reads.
 */
export function verifierProvenance(input: {
  verifierRoot: string;
  recipientRoot: string;
  nodeVersion: string;
}): VerifierProvenanceReport {
  if (typeof input.nodeVersion !== "string" || input.nodeVersion.length === 0) {
    throw new Error("nodeVersion must be a non-empty string.");
  }
  const isolation = checkVerifierIsolation({ depsDir: input.verifierRoot, recipientRoot: input.recipientRoot });
  try {
    return {
      node_version: input.nodeVersion,
      isolation,
      loaded_vitest: resolveLoadedVitest(input.verifierRoot),
    };
  } catch (err) {
    return {
      node_version: input.nodeVersion,
      isolation,
      loaded_vitest: null,
      loaded_vitest_error: err instanceof Error ? err.message : String(err),
    };
  }
}
