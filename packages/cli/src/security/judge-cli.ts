// `ludion judge`: judge an npm dependency update (an existing PR from Dependabot, Renovate or a person) between two
// checkouts of a project. Comments only (design, 判定役 v0): it never changes files.
import { lstatSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { allChanges, judge, lockEntries, lockEntryChanges, lockLinks, renderJudgement, type FixedAdvisory, type VersionFacts } from "./judge.ts";
import { gatherFacts } from "./npm-facts.ts";
import { regularFile, rootPath } from "./project.ts";

export async function judgeCli(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { before: { type: "string" }, after: { type: "string" }, files: { type: "string" }, now: { type: "string" }, json: { type: "boolean" } } });
  if (!values.before || !values.after) throw new Error("Give both checkouts: ludion judge --before <dir> --after <dir> --files <changed,files> [--json].");
  const before = rootPath(values.before), after = rootPath(values.after);
  const read = (root: string, file: string) => {
    const path = regularFile(root, file);
    if (lstatSync(path).size > 64 * 1024 * 1024) throw new Error(`${file} exceeds 64 MiB.`);
    return readFileSync(path, "utf8");
  };
  const beforeLock = read(before, "package-lock.json"), afterLock = read(after, "package-lock.json");
  const beforeManifest = read(before, "package.json"), afterManifest = read(after, "package.json");
  const manifest = beforeManifest === afterManifest ? undefined : { before: JSON.parse(beforeManifest), after: JSON.parse(afterManifest) };
  const beforeEntries = lockEntries(beforeLock), afterEntries = lockEntries(afterLock);
  const changes = allChanges(beforeLock, afterLock), entries = lockEntryChanges(beforeEntries, afterEntries);
  const hadLinks = new Set(lockLinks(beforeLock));
  const links = lockLinks(afterLock).filter(link => !hadLinks.has(link));
  // The changed files come from the caller (e.g. `git diff --name-only` in CI). Without them gate 4 cannot be judged.
  const files = values.files !== undefined ? values.files.split(",").map(f => f.trim()).filter(Boolean) : null;
  const now = values.now ? new Date(values.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO date.");
  let facts = new Map<string, VersionFacts>(), fixes: FixedAdvisory[] = [], errors: string[] = [];
  try { ({ facts, fixes } = await gatherFacts(changes, fetch, entries.map(e => ({ name: e.name, version: e.version })))); } catch (error) { errors = [error instanceof Error ? error.message : String(error)]; facts = new Map(); }
  const result = judge({ changes, entries, facts, fixes, files, links, now, errors, manifest });
  console.log(values.json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return result.verdict === "ready_except_build" ? 0 : result.verdict === "wait" ? 3 : 1;
}
