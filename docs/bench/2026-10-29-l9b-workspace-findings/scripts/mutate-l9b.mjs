// Mutation check of L9b's two fixes: each mutant must make a test in workspace-manifests.test.ts fail. Run in Docker on a
// writable copy (/w); the original is restored after each mutant.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const JUDGE = "/w/packages/cli/src/security/judge.ts", RULE = "/w/packages/cli/src/security/workspace-manifests.ts";
const mutants = [
  // 1. A "!" entry in the root's workspaces.
  [RULE, "a '!' entry excludes nothing again", "if (exclusion !== undefined) return", "if (false) return"],
  [RULE, "only the root before the change is read", "excludes(input.root.before) ?? excludes(input.root.after)", "excludes(input.root.before)"],
  [RULE, "only the root after the change is read", "excludes(input.root.before) ?? excludes(input.root.after)", "excludes(input.root.after)"],
  [RULE, "only a leading '!' counts", `p.includes("!")`, `p.startsWith("!")`],
  // 2. A top-level "__proto__" (own keys only).
  [JUDGE, "manifestChanges reads the before side through the prototype", "JSON.stringify(own(b, key)) ===", "JSON.stringify(b[key]) ==="],
  [JUDGE, "manifestChanges reads the after side through the prototype", "=== JSON.stringify(own(a, key))", "=== JSON.stringify(a[key])"],
  [RULE, "rule 5 reads the record before through the prototype", "JSON.stringify(own(recordBefore, key))", "JSON.stringify(recordBefore[key])"],
  [RULE, "rule 5 reads the record after through the prototype", "JSON.stringify(own(recordAfter, key))", "JSON.stringify(recordAfter[key])"],
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
