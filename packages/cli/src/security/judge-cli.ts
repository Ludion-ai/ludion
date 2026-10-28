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

export async function judgeCli(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { before: { type: "string" }, after: { type: "string" }, files: { type: "string" }, source: { type: "string" }, now: { type: "string" }, json: { type: "boolean" } } });
  if (!values.before || !values.after) throw new Error("Give both checkouts: ludion judge --before <dir> --after <dir> --files <changed,files> [--source <project dir>] [--json].");
  const before = rootPath(values.before), after = rootPath(values.after);
  const read = (root: string, file: string) => {
    const path = regularFile(root, file);
    if (lstatSync(path).size > 64 * 1024 * 1024) throw new Error(`${file} exceeds 64 MiB.`);
    return readFileSync(path, "utf8");
  };
  // The changed files come from the caller (e.g. `git diff --name-only` in CI). Without them gate 4 cannot be judged.
  const files = values.files !== undefined ? values.files.split(",").map(f => f.trim()).filter(Boolean) : null;
  const now = values.now ? new Date(values.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO date.");
  // pnpm: --source is not read; every changed version counts as production (pnpmChanges).
  if (!existsSync(join(after, "package-lock.json")) && existsSync(join(after, "pnpm-lock.yaml"))) return pnpm(read(before, "pnpm-lock.yaml"), read(after, "pnpm-lock.yaml"), JSON.parse(read(after, "package.json")), files, now, !!values.json);
  const beforeLock = read(before, "package-lock.json"), afterLock = read(after, "package-lock.json");
  const beforeManifest = read(before, "package.json"), afterManifest = read(after, "package.json");
  const manifest = beforeManifest === afterManifest ? undefined : { before: JSON.parse(beforeManifest), after: JSON.parse(afterManifest) };
  const beforeEntries = lockEntries(beforeLock), afterEntries = lockEntries(afterLock);
  // Gate 1's split (production.ts): a changed version is dev-only only when every installed copy of it is shown
  // dev-only. The source tree, read as text and never run, is the project at the judged commit; without it only test
  // runners, linters, formatters and @types packages can be dev-only.
  const split = productionSplit(afterLock, values.source ? readSourceTree(rootPath(values.source)) : null, JSON.parse(afterManifest));
  const changes = allChanges(beforeLock, afterLock).map(c => ({ ...c, dev: split.devOnly.has(`${c.name}@${c.to}`) }));
  const entries = lockEntryChanges(beforeEntries, afterEntries);
  const hadLinks = new Set(lockLinks(beforeLock));
  const links = lockLinks(afterLock).filter(link => !hadLinks.has(link));
  const extraneousBefore = lockExtraneous(beforeLock), extraneousAfter = lockExtraneous(afterLock);
  const extraneous = [...extraneousAfter.filter(e => !extraneousBefore.includes(e)), ...extraneousBefore.filter(e => !extraneousAfter.includes(e)).map(e => `(removed) ${e}`)];
  let facts = new Map<string, VersionFacts>(), fixes: FixedAdvisory[] = [], created = new Map<string, string | null>(), errors: string[] = [];
  try { ({ facts, fixes, created } = await gatherFacts(changes, fetch, entries.map(e => ({ name: e.name, version: e.version })))); } catch (error) { errors = [error instanceof Error ? error.message : String(error)]; facts = new Map(); }
  const locked = new Set(beforeEntries.map(e => `${e.name}@${e.version}`));
  const result = judge({ changes, entries, facts, fixes, files, links, extraneous, now, errors, manifest, locked, created, direct: declaredByProject(afterLock), split: split.summary });
  console.log(values.json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return exitCode(result.verdict);
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
