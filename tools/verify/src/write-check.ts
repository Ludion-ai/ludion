// Entry points the P1 Capability runner will call later. Nothing on main runs
// vitest yet. After a run, the runner diffs the recipient tree and rejects a
// write that is a symlink, leaves the root, matches a protected pattern, or
// matches no declared write glob.
//
// The glob matcher below is self-contained (`*`, `**`, `?`). P1's
// packages/capability/src/glob.ts is not on main; matchGlob can be swapped for it later.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { isInside } from "./verifier-deps.ts";

export interface SnapshotEntry {
  kind: "file" | "symlink" | "dir";
  sha256?: string;
  linkTarget?: string;
}

/** Closed for now. Unknown keys are rejected so a caller cannot add a skip list. */
export type SnapshotOptions = Record<string, never>;

export type WriteReason = "symlink" | "outside_root" | "protected" | "undeclared";

export interface WriteViolation {
  path: string;
  reason: WriteReason;
}

/**
 * Paths a lesson run must not create or edit. `**` matches across segments, including
 * zero segments, so `node_modules/**` also matches the `node_modules` directory itself.
 */
export const DEFAULT_PROTECTED: readonly string[] = [
  "tools/verify/**",
  ".github/**",
  "node_modules/**",
  "**/node_modules/**",
  "package.json",
  "**/package.json",
  "package-lock.json",
  "**/package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "vitest.config.*",
  "vitest.workspace.*",
  "vite.config.*",
  "**/vitest.config.*",
  "**/vite.config.*",
  "**/vitest.setup.*",
  "**/setupTests.*",
  "**/test/setup.*",
  "tsconfig.json",
  "**/tsconfig*.json",
  ".npmrc",
  "**/.npmrc",
];

function fold(text: string): string {
  return process.platform === "win32" ? text.toLowerCase() : text;
}

/** One path segment. `*` and `?` never cross `/`. */
function matchSegment(pattern: string, text: string): boolean {
  const p = fold(pattern);
  const t = fold(text);
  const memo = new Map<string, boolean>();
  const go = (i: number, j: number): boolean => {
    const key = `${i}:${j}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let result: boolean;
    if (i === p.length) result = j === t.length;
    else if (p.charAt(i) === "*") result = go(i + 1, j) || (j < t.length && go(i, j + 1));
    else if (j < t.length && (p.charAt(i) === "?" || p.charAt(i) === t.charAt(j))) result = go(i + 1, j + 1);
    else result = false;
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

function segmentsOf(path: string): string[] {
  const norm = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (norm === "" || norm === ".") return [];
  return norm.split("/");
}

/**
 * Glob match for a relative posix path. `**` is only special as a whole segment and matches
 * zero or more segments. Case-insensitive on win32. `.` in a pattern is literal.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const pat = segmentsOf(pattern);
  const parts = segmentsOf(path);
  const memo = new Map<string, boolean>();
  const go = (pi: number, si: number): boolean => {
    const key = `${pi}:${si}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let result: boolean;
    if (pi === pat.length) result = si === parts.length;
    else if (pat[pi] === "**") {
      result = false;
      for (let k = si; k <= parts.length; k++) {
        if (go(pi + 1, k)) {
          result = true;
          break;
        }
      }
    } else if (si < parts.length && matchSegment(pat[pi] ?? "", parts[si] ?? "")) result = go(pi + 1, si + 1);
    else result = false;
    memo.set(key, result);
    return result;
  };
  return go(0, 0);
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchGlob(pattern, path));
}

function posixRelative(root: string, target: string): string {
  return relative(root, target).split(sep).join("/");
}

/**
 * Snapshot `root` without following symlinks or junctions. A symlink is one entry
 * (its link text), never a walk into the target. The only skipped name is a real
 * directory named `.git`. A symlink or file named `.git` is recorded: that is a write,
 * not the git database.
 */
export function snapshotTree(root: string, opts?: SnapshotOptions): Map<string, SnapshotEntry> {
  if (opts !== undefined) {
    if (opts === null || typeof opts !== "object" || Array.isArray(opts)) throw new Error("snapshot options must be an object.");
    for (const key of Object.keys(opts)) throw new Error(`Unknown snapshot option ${key}.`);
  }
  if (!statSync(root).isDirectory()) throw new Error("snapshot root must be a directory.");
  const out = new Map<string, SnapshotEntry>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = resolve(dir, name);
      const st = lstatSync(abs);
      const rel = posixRelative(root, abs);
      if (name === ".git" && st.isDirectory()) continue;
      if (st.isSymbolicLink()) {
        let linkTarget = "";
        try {
          linkTarget = readlinkSync(abs, "utf8");
        } catch {
          linkTarget = "";
        }
        out.set(rel, { kind: "symlink", linkTarget });
        continue;
      }
      if (st.isDirectory()) {
        out.set(rel, { kind: "dir" });
        walk(abs);
        continue;
      }
      if (st.isFile()) {
        out.set(rel, { kind: "file", sha256: createHash("sha256").update(readFileSync(abs)).digest("hex") });
        continue;
      }
      out.set(rel, { kind: "file" });
    }
  };
  walk(root);
  return out;
}

/** Added, removed, content-changed, link-target-changed, and kind-changed paths, sorted. */
export function diffSnapshots(before: ReadonlyMap<string, SnapshotEntry>, after: ReadonlyMap<string, SnapshotEntry>): string[] {
  const changed: string[] = [];
  const keys = new Set<string>([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const left = before.get(key);
    const right = after.get(key);
    if (!left || !right || left.kind !== right.kind || left.sha256 !== right.sha256 || left.linkTarget !== right.linkTarget) {
      changed.push(key);
    }
  }
  changed.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return changed;
}

interface Located {
  /** The final path component is a symlink or junction, or a missing path's nearest parent is. */
  symlink: boolean;
  /** realpath of the existing node, or of the nearest existing parent when the path was deleted. */
  real: string;
  /** Relative posix path of an existing node inside `rootReal`, when there is one. */
  realRel: string | null;
}

function locate(rootReal: string, changedPath: string): Located {
  const abs = resolve(rootReal, changedPath);
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      let real = abs;
      try {
        real = realpathSync(abs);
      } catch {
        // Dangling link: the violation is the symlink itself.
      }
      return { symlink: true, real, realRel: null };
    }
    const real = realpathSync(abs);
    const inside = isInside(real, rootReal);
    return { symlink: false, real, realRel: inside ? posixRelative(rootReal, real) : null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }

  let current = abs;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) return { symlink: false, real: current, realRel: null };
    try {
      const st = lstatSync(parent);
      if (st.isSymbolicLink()) {
        let real = parent;
        try {
          real = realpathSync(parent);
        } catch {
          // The parent link is the problem.
        }
        return { symlink: true, real, realRel: null };
      }
      const real = realpathSync(parent);
      return { symlink: false, real, realRel: null };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      current = parent;
    }
  }
}

/**
 * One reason per changed path, in this order: symlink, outside_root, protected, undeclared.
 * `protectedPatterns` replaces {@link DEFAULT_PROTECTED} when the caller passes it.
 * A declared glob does not excuse a protected path.
 */
export function checkWrites(input: {
  root: string;
  changed: readonly string[];
  declaredWrites: readonly string[];
  protectedPatterns?: readonly string[];
}): { ok: boolean; violations: WriteViolation[] } {
  if (!Array.isArray(input.changed)) throw new Error("changed must be a list of paths.");
  if (!Array.isArray(input.declaredWrites)) throw new Error("declaredWrites must be a list of globs.");
  const protectedPatterns = input.protectedPatterns ?? DEFAULT_PROTECTED;
  const rootReal = realpathSync(input.root);
  const violations: WriteViolation[] = [];
  const seen = new Set<string>();
  for (const changedPath of input.changed) {
    if (typeof changedPath !== "string") throw new Error("changed paths must be strings.");
    if (seen.has(changedPath)) continue;
    seen.add(changedPath);
    const located = locate(rootReal, changedPath);
    let reason: WriteReason | null = null;
    if (located.symlink) reason = "symlink";
    else if (!isInside(located.real, rootReal)) reason = "outside_root";
    else if (matchesAny(changedPath, protectedPatterns) || (located.realRel !== null && located.realRel !== "" && matchesAny(located.realRel, protectedPatterns))) {
      reason = "protected";
    } else if (!matchesAny(changedPath, input.declaredWrites)) reason = "undeclared";
    if (reason) violations.push({ path: changedPath, reason });
  }
  violations.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: violations.length === 0, violations };
}
