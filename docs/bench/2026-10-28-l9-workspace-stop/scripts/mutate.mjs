// Mutation check: each mutant must make at least one test in workspace-manifests.test.ts fail.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const file = "/w/packages/cli/src/security/workspace-manifests.ts";
const original = readFileSync(file, "utf8");
const mutants = [
  ["always agrees", "  const { file, before, after } = input;", "  const { file, before, after } = input; if (input) return [];"],
  ["rule 1 off (any folder)", "  if (!declaredWorkspace(input.root.before, dir) || !declaredWorkspace(input.root.after, dir))", "  if (false)"],
  ["rule 1 after only", "!declaredWorkspace(input.root.before, dir) || ", ""],
  ["rule 1 glob loosened", `s === "*" || (plainSegment(s) && s === want[i])`, `s.includes("*") || (plainSegment(s) && s === want[i])`],
  ["rule 1 non-plain dir", "return dir.split(\"/\").every(plainSegment) ? dir : null;", "return dir;"],
  ["rule 2 off", "if (!isObject(recordBefore) || !isObject(recordAfter)) return", "if (false) return"],
  ["rule 3 sides off", "if (!isObject(before) || !isObject(after)) return [`${file} is not a JSON object on both sides (before and after).`];", "if (!isObject(before) || !isObject(after)) return [];"],
  ["rule 3 overrides off", "if (JSON.stringify(overridesBefore) !== JSON.stringify(overridesAfter)) out.push", "if (false) out.push"],
  ["rule 3 manifestChanges off", "out.push(...manifestChanges(restBefore, restAfter)", "out.push(...[].slice(0, 0)"],
  ["rule 4 before off", "if (listOf(before, key) !== listOf(recordBefore, key)) out.push", "if (false) out.push"],
  ["rule 4 after off", "if (listOf(after, key) !== listOf(recordAfter, key)) out.push", "if (false) out.push"],
  ["rule 5 off", "if (!GROUPS.includes(key) && JSON.stringify(recordBefore[key]) !== JSON.stringify(recordAfter[key])) out.push", "if (false) out.push"],
  ["missing list not empty", "const value = owner[key] ?? {};", "const value = owner[key];"],
  ["key order counts", "Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)", "Object.entries(value)"],
];
let survived = 0;
for (const [name, from, to] of mutants) {
  if (!original.includes(from)) { console.log(`NOT APPLIED: ${name}`); survived++; continue; }
  writeFileSync(file, original.replace(from, to));
  const r = spawnSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/workspace-manifests.test.ts"], { cwd: "/w", encoding: "utf8" });
  const failed = /(\d+) failed/.exec(r.stdout)?.[1] ?? "0";
  console.log(`${r.status === 0 ? "SURVIVED" : "killed  "} ${name} (failed tests: ${failed})`);
  if (r.status === 0) survived++;
}
writeFileSync(file, original);
console.log(`survived: ${survived} of ${mutants.length}`);
