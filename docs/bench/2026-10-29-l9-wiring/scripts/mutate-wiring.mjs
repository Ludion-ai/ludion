// Mutation check of the wiring: each mutant of judge.ts, judge-cli.ts (or the review fixes in workspace-manifests.ts) must make at least one test in
// workspace-manifests.test.ts fail. Run in Docker on a writable copy (/w); the original is restored at the end.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const JUDGE = "/w/packages/cli/src/security/judge.ts", CLI = "/w/packages/cli/src/security/judge-cli.ts", RULE = "/w/packages/cli/src/security/workspace-manifests.ts";
const mutants = [
  [JUDGE, "agreeing files still stop", "&& !agreeing.includes(f));", ");"],
  [JUDGE, "any read file agrees", "w.reasons?.length === 0 &&", "w.reasons !== null &&"],
  [JUDGE, "an unread file agrees", "w.reasons?.length === 0 &&", "(w.reasons ?? []).length === 0 &&"],
  [JUDGE, "files not in the PR's list count", "&& input.files!.includes(w.file))", ")"],
  [JUDGE, "reasons not stopped on", "else for (const message of reasons) add(", "else for (const message of [] as string[]) add("],
  [JUDGE, "an unread file not undecidable", "whether it agrees with the lockfile is undecidable.` }); undecidable = true; }", "whether it agrees with the lockfile is undecidable.` }); }"],
  [JUDGE, "an unread file not stopped on", "if (reasons === null) { add({ gate: 4, effect: \"stop\"", "if (reasons === null) { add({ gate: 4, effect: \"info\""],
  [JUDGE, "no info line", "if (agreeing.length) add(", "if (false) add("],
  [CLI, "not passed to judge()", "split: split.summary, workspaces });", "split: split.summary });"],
  [CLI, "an unreadable side agrees", "catch { return { file, reasons: null }; }", "catch { return { file, reasons: [] }; }"],
  [CLI, "no plain-folder check before reading", "if (workspaceDir(file) === null) return", "if (false) return"],
  [CLI, "every listed file read", "file !== \"package.json\" && file.endsWith(\"/package.json\")", "file !== \"package.json\""],
  [CLI, "the lockfile's before side used for after", "after: packages(lock.after)", "after: packages(lock.before)"],
  [CLI, "an unparsable file read as empty object", "catch { return undefined; }", "catch { return {}; }"],
  // The review's two findings on the rule (#174, comment 6473296446).
  [RULE, "a * matches a dot folder", ` && have.every((s, i) => s !== "*" || !want[i]!.startsWith("."))`, ""],
  [RULE, "inherited keys count as records (before)", "Object.hasOwn(input.lock.before, dir) ? input.lock.before[dir] : undefined", "input.lock.before[dir]"],
  [RULE, "inherited keys count as records (after)", "Object.hasOwn(input.lock.after, dir) ? input.lock.after[dir] : undefined", "input.lock.after[dir]"],
];
let survived = 0;
for (const [file, name, from, to] of mutants) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`NOT APPLIED: ${name}`); survived++; continue; }
  writeFileSync(file, original.replace(from, to));
  const r = spawnSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/workspace-manifests.test.ts"], { cwd: "/w", encoding: "utf8" });
  writeFileSync(file, original);
  const failed = /(\d+) failed/.exec(r.stdout)?.[1] ?? "0";
  console.log(`${r.status === 0 ? "SURVIVED" : "killed  "} ${name} (failed tests: ${failed})`);
  if (r.status === 0) survived++;
}
console.log(`survived: ${survived} of ${mutants.length}`);
