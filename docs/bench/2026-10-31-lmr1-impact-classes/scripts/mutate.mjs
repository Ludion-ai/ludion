// node mutate.mjs (in /w, from mutate.sh): each mutation changes impact.ts once; impact.test.ts must fail with it and
// pass without it. Edits use split/join, so no replacement pattern is expanded.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const file = "packages/cli/src/security/impact.ts";
const original = readFileSync(file, "utf8");
const mutations = [
  ["MAL- is not trap", 'id.startsWith("MAL-")', 'id.startsWith("MAL-X")'],
  ["MAL- anywhere in the id is trap", 'id.startsWith("MAL-")', 'id.includes("MAL-")'],
  ["the weakest class wins", "IMPACT_ORDER.indexOf(cls) < IMPACT_ORDER.indexOf(best.cls)", "IMPACT_ORDER.indexOf(cls) > IMPACT_ORDER.indexOf(best.cls)"],
  ["the first CWE wins", "if (cls && (!best || IMPACT_ORDER.indexOf(cls) < IMPACT_ORDER.indexOf(best.cls)))", "if (cls && !best)"],
  ["CWE-78 leaves the table", "takeover: [77, 78, 94,", "takeover: [77, 94,"],
  ["CWE-506 becomes trap", "impersonate: [79,", "trap: [506], impersonate: [79,"],
  ["cwe_ids not read", "Array.isArray(specific.cwe_ids) ? specific.cwe_ids : []", "[]"],
  ["any severity string kept", "(SEVERITIES as readonly string[]).includes(raw) ? (raw as Severity) : \"unknown\"", "(raw || \"unknown\") as Severity"],
  ["| not escaped", '.replace(/\\|/g, "\\\\|")', ""],
  ["line breaks kept", '[\\r\\n\\u{2028}\\u{2029}]/gu, " ")', '[\\u{2028}\\u{2029}]/gu, " ")'],
  ["fence not lengthened", "Math.max(0, ...[...flat.matchAll(/`+/g)].map(m => m[0].length)) + 1", "1"],
  ["minutes rounded, not floored", "Math.floor((acted - instant", "Math.round((acted - instant"],
  ["action before the fix accepted", "if (minutes < 0) throw", "if (minutes < -1e12) throw"],
  ["Feb 30 accepted", "new Date(at).toISOString().slice(0, 19) !== match[1]", "false"],
  ["summary counts every action as fixed", "`${l.count[a]} ${counts.get(a)}`", "`${l.count.fixed} ${counts.get(a)}`"],
];
const run = () => {
  try {
    execFileSync("npx", ["vitest", "run", "--project", "node", "packages/cli/test/impact.test.ts"], { stdio: "pipe", env: { ...process.env, NO_COLOR: "1" } });
    return "passed";
  } catch {
    return "failed";
  }
};
console.log(`without mutations: ${run()}`);
let caught = 0;
for (const [name, from, to] of mutations) {
  const parts = original.split(from);
  if (parts.length !== 2) { console.log(`NOT APPLIED (${parts.length - 1} matches): ${name}`); continue; }
  writeFileSync(file, parts.join(to));
  const result = run();
  if (result === "failed") caught++;
  console.log(`${result === "failed" ? "caught" : "SURVIVED"}: ${name}`);
}
writeFileSync(file, original);
console.log(`after restoring: ${run()}`);
console.log(`${caught} of ${mutations.length} mutations caught`);
