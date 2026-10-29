// `ludion judge`: judge an npm dependency update (an existing PR from Dependabot, Renovate or a person) between two
// checkouts of a project. Comments only (design, 判定役 v0): it never changes files.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { fromPnpmLock } from "../lockfile.ts";
import { parseArgs } from "node:util";
import { allChanges, declaredByProject, judge, lockEntries, lockEntryChanges, lockExtraneous, lockLinks, renderJudgement, type Change, type FixedAdvisory, type VersionFacts } from "./judge.ts";
import { gatherFacts } from "./npm-facts.ts";
import { productionSplit, readSourceTree } from "./production.ts";
import { regularFile, rootPath } from "./project.ts";
import { workspaceDir, workspaceManifestChanges } from "./workspace-manifests.ts";

function readText(root: string, file: string): string {
  const path = regularFile(root, file);
  if (lstatSync(path).size > 64 * 1024 * 1024) throw new Error(`${file} exceeds 64 MiB.`);
  return readFileSync(path, "utf8");
}

export async function judgeCli(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { before: { type: "string" }, after: { type: "string" }, files: { type: "string" }, source: { type: "string" }, now: { type: "string" }, json: { type: "boolean" } } });
  if (!values.before || !values.after) throw new Error("Give both checkouts: ludion judge --before <dir> --after <dir> --files <changed,files> [--source <project dir>] [--json].");
  const before = rootPath(values.before), after = rootPath(values.after);
  // The changed files come from the caller (e.g. `git diff --name-only` in CI). Without them gate 4 cannot be judged.
  const files = values.files !== undefined ? values.files.split(",").map(f => f.trim()).filter(Boolean) : null;
  const now = values.now ? new Date(values.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO date.");
  // pnpm: --source is not read; every changed version counts as production (pnpmChanges).
  if (!existsSync(join(after, "package-lock.json")) && existsSync(join(after, "pnpm-lock.yaml"))) return pnpm(readText(before, "pnpm-lock.yaml"), readText(after, "pnpm-lock.yaml"), JSON.parse(readText(after, "package.json")), files, now, !!values.json);
  const beforeLock = readText(before, "package-lock.json"), afterLock = readText(after, "package-lock.json");
  const beforeManifest = readText(before, "package.json"), afterManifest = readText(after, "package.json");
  const lock = packageLockInputs({ before: beforeLock, after: afterLock }, { before: beforeManifest, after: afterManifest });
  // Gate 1's split (production.ts): a changed version is dev-only only when every installed copy of it is shown
  // dev-only. The source tree, read as text and never run, is the project at the judged commit; without it only test
  // runners, linters, formatters and @types packages can be dev-only.
  const split = productionSplit(afterLock, values.source ? readSourceTree(rootPath(values.source)) : null, JSON.parse(afterManifest));
  const changes = lock.changes.map(c => ({ ...c, dev: split.devOnly.has(`${c.name}@${c.to}`) }));
  let facts = new Map<string, VersionFacts>(), fixes: FixedAdvisory[] = [], created = new Map<string, string | null>(), errors: string[] = [];
  try { ({ facts, fixes, created } = await gatherFacts(changes, fetch, lock.entries.map(e => ({ name: e.name, version: e.version })))); } catch (error) { errors = [error instanceof Error ? error.message : String(error)]; facts = new Map(); }
  const workspaces = workspaceManifests(before, after, files, { before: JSON.parse(beforeManifest), after: JSON.parse(afterManifest) }, { before: beforeLock, after: afterLock });
  const result = judge({ ...lock, changes, facts, fixes, files, now, errors, created, split: split.summary, workspaces });
  console.log(values.json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return exitCode(result.verdict);
}

/**
 * What the judge reads from a package-lock change besides the registry's facts: every changed version (`dev` as the
 * lockfile records it), every entry that changed at its path, new links and extraneous folders, the package.json
 * change, what was locked before and what the project declares. `ludion judge` and `ludion patch` (candidate-judge.ts)
 * both judge from it.
 */
export function packageLockInputs(lock: { before: string; after: string }, manifest: { before: string; after: string }) {
  const beforeEntries = lockEntries(lock.before), afterEntries = lockEntries(lock.after);
  const hadLinks = new Set(lockLinks(lock.before));
  const extraneousBefore = lockExtraneous(lock.before), extraneousAfter = lockExtraneous(lock.after);
  return {
    changes: allChanges(lock.before, lock.after),
    entries: lockEntryChanges(beforeEntries, afterEntries),
    links: lockLinks(lock.after).filter(link => !hadLinks.has(link)),
    extraneous: [...extraneousAfter.filter(e => !extraneousBefore.includes(e)), ...extraneousBefore.filter(e => !extraneousAfter.includes(e)).map(e => `(removed) ${e}`)],
    manifest: manifest.before === manifest.after ? undefined : { before: JSON.parse(manifest.before) as unknown, after: JSON.parse(manifest.after) as unknown },
    locked: new Set(beforeEntries.map(e => `${e.name}@${e.version}`)),
    direct: declaredByProject(lock.after),
  };
}

/**
 * Each changed `<dir>/package.json` of the two checkouts, with why it is more than the lockfile's dependency update
 * (workspace-manifests.ts): no reasons when it agrees, null when a side could not be read (undecidable).
 */
export function workspaceManifests(before: string, after: string, files: string[] | null, root: { before: unknown; after: unknown }, lock: { before: string; after: string }): { file: string; reasons: string[] | null }[] {
  const packages = (text: string) => (JSON.parse(text) as { packages?: Record<string, unknown> }).packages ?? {};
  const locks = { before: packages(lock.before), after: packages(lock.after) };
  const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
  return (files ?? []).filter(file => file !== "package.json" && file.endsWith("/package.json")).map(file => {
    if (workspaceDir(file) === null) return { file, reasons: workspaceManifestChanges({ file, before: undefined, after: undefined, root, lock: locks }) };
    let texts: [string, string];
    try { texts = [readText(before, file), readText(after, file)]; } catch { return { file, reasons: null }; }
    return { file, reasons: workspaceManifestChanges({ file, before: parse(texts[0]), after: parse(texts[1]), root, lock: locks }) };
  });
}

const exitCode = (verdict: string) => verdict === "ready_except_build" ? 0 : verdict === "wait" ? 3 : 1;

/** pnpm: the versions pnpm-lock.yaml adds, each against the highest locked version of the same major line. Never ready. */
export function pnpmChanges(beforeText: string, afterText: string): { changes: Change[]; locked: Set<string> } {
  const before = fromPnpmLock(beforeText), after = fromPnpmLock(afterText);
  const locked = new Set([...before].flatMap(([name, versions]) => [...versions].map(v => `${name}@${v}`)));
  const changes: Change[] = [];
  for (const [name, versions] of after) for (const to of versions) {
    if (locked.has(`${name}@${to}`) || !semver.valid(to)) continue;
    const from = [...before.get(name) ?? []].filter(v => semver.valid(v) && semver.major(v) === semver.major(to)).sort(semver.rcompare)[0] ?? null;
    changes.push({ path: "pnpm-lock.yaml", name, from, to, dev: false, resolved: null, integrity: null, replaced: null });
  }
  return { changes: changes.sort((a, b) => a.name.localeCompare(b.name) || semver.compare(a.to, b.to)), locked };
}

async function pnpm(beforeLock: string, afterLock: string, manifest: any, files: string[] | null, now: Date, json: boolean): Promise<number> {
  const { changes, locked } = pnpmChanges(beforeLock, afterLock);
  let facts = new Map<string, VersionFacts>(), fixes: FixedAdvisory[] = [], created = new Map<string, string | null>(), errors: string[] = [];
  try { ({ facts, fixes, created } = await gatherFacts(changes, fetch)); } catch (error) { errors = [error instanceof Error ? error.message : String(error)]; facts = new Map(); }
  const direct = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].flatMap(g => manifest?.[g] && typeof manifest[g] === "object" ? Object.keys(manifest[g]) : []);
  const result = judge({ changes, facts, fixes, files, now, errors, locked, created, direct, lockfile: "pnpm-lock", split: { source: "pnpm", incomplete: null, images_with_dev: [] } });
  console.log(json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return exitCode(result.verdict);
}
