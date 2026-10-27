// `ludion judge`: judge an npm dependency update (an existing PR from Dependabot, Renovate or a person) between two
// checkouts of a project. Comments only (design, 判定役 v0): it never changes files.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { judge, lockDiff, lockEntries, renderJudgement } from "./judge.ts";
import { gatherFacts } from "./npm-facts.ts";
import { regularFile, rootPath } from "./project.ts";

export async function judgeCli(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { before: { type: "string" }, after: { type: "string" }, files: { type: "string" }, now: { type: "string" }, json: { type: "boolean" } } });
  if (!values.before || !values.after) throw new Error("Give both checkouts: ludion judge --before <dir> --after <dir> [--files a,b] [--json].");
  const before = rootPath(values.before), after = rootPath(values.after);
  const read = (root: string, file: string) => {
    const path = regularFile(root, file);
    const text = readFileSync(path, "utf8");
    if (text.length > 64 * 1024 * 1024) throw new Error(`${file} exceeds 64 MiB.`);
    return text;
  };
  const changes = lockDiff(lockEntries(read(before, "package-lock.json")), lockEntries(read(after, "package-lock.json")));
  // The changed files come from the caller (e.g. `git diff --name-only` in CI). Without them, compare the two
  // dependency files only, and say so.
  const files = values.files !== undefined
    ? values.files.split(",").map(f => f.trim()).filter(Boolean)
    : ["package.json", "package-lock.json"].filter(f => read(before, f) !== read(after, f));
  const now = values.now ? new Date(values.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("--now must be an ISO date.");
  const { facts, fixes } = await gatherFacts(changes);
  const result = judge({ changes, facts, fixes, files, now });
  if (values.files === undefined) result.not_checked.push("Files other than package.json and package-lock.json were not compared; pass --files from the PR's diff.");
  console.log(values.json ? JSON.stringify(result, null, 2) : renderJudgement(result));
  return result.verdict === "ready_except_build" ? 0 : result.verdict === "wait" ? 3 : 1;
}
