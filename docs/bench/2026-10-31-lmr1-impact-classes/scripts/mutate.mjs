// node mutate.mjs (in /w, from mutate.sh): each mutation changes impact.ts once, one at a time; impact.test.ts must fail with it and
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
  // LMR1b: trap as a published record, and stops with their reasons.
  ["a MAL- alias is not trap", "if (malAlias) return", "if (false && malAlias) return"],
  ["an alias containing MAL- anywhere is trap", 'alias.startsWith("MAL-")', 'alias.includes("MAL-")'],
  ["CWE-506 is not trap", "if (numbers.has(TRAP_CWE)) return", "if (false) return"],
  ["CWE-912 is trap too", "if (numbers.has(TRAP_CWE)) return", "if (numbers.has(TRAP_CWE) || numbers.has(912)) return"],
  ["a trap stop is accepted without its record classifying as trap", 'if (c.class !== "trap") throw', "if (false) throw"],
  ["every stop is counted as a trap", "unverified.set(stop.reason, (unverified.get(stop.reason) ?? 0) + 1);", "traps++;"],
  ["traps are counted as unverified", "traps++;", 'unverified.set("undecidable", (unverified.get("undecidable") ?? 0) + 1);'],
  ["a stopped row with no reason is accepted", "throw new Error(`Row ${i}: a stopped row needs its reason`);", 'did = "";'],
  ["a stop reason on another action is accepted", "if (stop != null) throw", "if (false) throw"],
  ["an unknown stop reason is accepted", "} else if (STOP_REASONS.includes(stop.reason)) {", "} else if (true) {"],
  ["stop reasons counted in the order given", "const reasons = STOP_REASONS.filter(r => unverified.has(r));", "const reasons = [...unverified.keys()];"],
  ["the reasons left out of the summary", "`${l.unverified} ${total}${l.reasons(reasons.map(r => `${l.stop[r]} ${unverified.get(r)}`).join(l.join))}`", "`${l.unverified} ${total}`"],
  ["the trap cell without the record's id", "did = l.trapCell(code((stop.record as { id: string }).id));", 'did = l.trapCell("");'],
  ["the record's id not escaped", "l.trapCell(code((stop.record as { id: string }).id))", 'l.trapCell("`" + (stop.record as { id: string }).id + "`")'],
  ["the Japanese unverified label shortened", 'unverified: "確かめられなかったので止めた",', 'unverified: "止めた",'],
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
