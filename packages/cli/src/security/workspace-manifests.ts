// Gate 4 and a workspace's own package.json. Dependabot changes it when it updates that workspace's dependency; the
// change is a dependency update only when it agrees with the lockfile (docs/decisions.md, "Workspace package.json
// changes in the judge's gate 4").
import { manifestChanges } from "./judge.ts";

const GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const SEGMENT = /^[A-Za-z0-9@._-]+$/;
const plainSegment = (s: string) => SEGMENT.test(s) && s !== "." && s !== ".." && s !== "node_modules";

/** The folder of a changed `<dir>/package.json` when it is a plain relative folder; null for the root's and any other file. */
export function workspaceDir(file: string): string | null {
  if (!file.endsWith("/package.json")) return null;
  const dir = file.slice(0, -"/package.json".length);
  return dir.split("/").every(plainSegment) ? dir : null;
}

/** Whether the root manifest's `workspaces` (an array of strings) matches `dir`: literal segments and a whole-segment `*` only. */
function declaredWorkspace(root: unknown, dir: string): boolean {
  const patterns = (root as { workspaces?: unknown } | null)?.workspaces;
  if (!Array.isArray(patterns)) return false;
  const want = dir.split("/");
  return patterns.some(pattern => {
    if (typeof pattern !== "string") return false;
    const have = pattern.replace(/^\.\//, "").replace(/\/$/, "").split("/");
    return have.length === want.length && have.every((s, i) => s === "*" || (plainSegment(s) && s === want[i]));
  });
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** A dependency list as data: a missing list is empty, and key order does not count. */
const listOf = (owner: Record<string, unknown>, key: string) => {
  const value = owner[key] ?? {};
  return JSON.stringify(isObject(value) ? Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) : value);
};

/**
 * Why a changed workspace package.json is more than the dependency update the lockfile records. Empty when it agrees:
 * a workspace of the root manifest on both sides, recorded by both lockfiles, with only registry dependency specs
 * changed, and each dependency list equal to the lockfile's record of that workspace before and after.
 */
export function workspaceManifestChanges(input: {
  /** The changed file, relative to the project root. */
  file: string;
  /** The workspace's package.json before and after, parsed; undefined for a side that has none. */
  before: unknown;
  after: unknown;
  /** The root package.json before and after, parsed. */
  root: { before: unknown; after: unknown };
  /** The lockfile's `packages` before and after. */
  lock: { before: Record<string, unknown>; after: Record<string, unknown> };
}): string[] {
  const { file, before, after } = input;
  const dir = workspaceDir(file);
  if (dir === null) return [`${file} is not the package.json of a plain workspace folder.`];
  if (!declaredWorkspace(input.root.before, dir) || !declaredWorkspace(input.root.after, dir)) return [`${dir} is not a workspace that the root package.json's "workspaces" names (literal folders and a whole-segment * only), before and after.`];
  const recordBefore = input.lock.before[dir], recordAfter = input.lock.after[dir];
  if (!isObject(recordBefore) || !isObject(recordAfter)) return [`The lockfile does not record the workspace ${dir} both before and after.`];
  if (!isObject(before) || !isObject(after)) return [`${file} is not a JSON object on both sides (before and after).`];

  const out: string[] = [];
  const { overrides: overridesBefore, ...restBefore } = before, { overrides: overridesAfter, ...restAfter } = after;
  if (JSON.stringify(overridesBefore) !== JSON.stringify(overridesAfter)) out.push(`${file} changes "overrides", which npm reads only in the root package.json; the lockfile cannot show it.`);
  out.push(...manifestChanges(restBefore, restAfter).map(message => message.replace(/^package\.json/, file)));
  for (const key of GROUPS) {
    if (listOf(before, key) !== listOf(recordBefore, key)) out.push(`Before the change, ${file} ${key} is not the lockfile's record of ${dir}.`);
    if (listOf(after, key) !== listOf(recordAfter, key)) out.push(`After the change, ${file} ${key} is not the lockfile's record of ${dir}.`);
  }
  for (const key of [...new Set([...Object.keys(recordBefore), ...Object.keys(recordAfter)])].sort()) {
    if (!GROUPS.includes(key) && JSON.stringify(recordBefore[key]) !== JSON.stringify(recordAfter[key])) out.push(`The lockfile's record of ${dir} changes "${key}", which is not a dependency list.`);
  }
  return out;
}
