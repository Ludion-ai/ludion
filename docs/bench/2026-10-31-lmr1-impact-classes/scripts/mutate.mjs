// node mutate.mjs (in /w, from mutate.sh): each mutation changes impact.ts once, one at a time; impact.test.ts must fail with it and
// pass without it. Edits use split/join, so no replacement pattern is expanded.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const file = "packages/cli/src/security/impact.ts";
const original = readFileSync(file, "utf8");
const mutations = [
  ["MAL- is not trap", 'id.startsWith("MAL-")', 'id.startsWith("MAL-X")'],
  ["MAL- anywhere in the id is trap", 'id.startsWith("MAL-")', 'id.includes("MAL-")'],
  // LMR1's three on the table, as the code reads since LMR1c (with no vector).
  ["the weakest class wins", "(!best || rank(l.classes[0]!) < rank(best.cls))) best =", "(!best || rank(l.classes[0]!) > rank(best.cls))) best ="],
  ["the first CWE wins", "if (l.classes.length === 1 && (!best || rank(l.classes[0]!) < rank(best.cls))) best", "if (l.classes.length === 1 && !best) best"],
  ["CWE-78 leaves the table", '[["takeover"], [77, 78, 94,', '[["takeover"], [77, 94,'],
  // LMR1c: each CWE's set of classes, and the CVSS vectors that choose among them.
  ["the vectors are not read", "const read = vectors(record as Record<string, unknown>);", "const read = { affects: [] } as { affects: Affects[] };"],
  ["the weakest consistent class wins", "const best = allowed.find(cls => read.affects.every(CONSISTENT[cls]));", "const best = allowed.findLast(cls => read.affects.every(CONSISTENT[cls]));"],
  ["one consistent vector is enough", "read.affects.every(CONSISTENT[cls])", "read.affects.some(CONSISTENT[cls])"],
  ["steal needs no confidentiality", "steal: v => v.c,", "steal: () => true,"],
  ["alter read from confidentiality", "alter: v => v.i,", "alter: v => v.c,"],
  ["disrupt needs no availability", "disrupt: v => v.a,", "disrupt: () => true,"],
  ["impersonate by confidentiality only", "impersonate: v => v.c || v.i,", "impersonate: v => v.c,"],
  ["takeover needs all three", "takeover: v => v.c || v.i || v.a,", "takeover: v => v.c && v.i && v.a,"],
  ["CVSS 4's subsequent systems not read", 'c: ["VC", "SC"], i: ["VI", "SI"], a: ["VA", "SA"]', 'c: ["VC"], i: ["VI"], a: ["VA"]'],
  ["a vector of another version accepted", "prefix: /^CVSS:3\\.[01]\\//", "prefix: /^CVSS:/"],
  ["a score of another form skipped", "if (typeof score !== \"string\" || !spec.prefix.test(score)) return", "if (typeof score !== \"string\" || !spec.prefix.test(score)) continue; if (false) return"],
  ["a metric given twice accepted", "if (seen.length !== 1 ||", "if (seen.length < 1 ||"],
  ["any metric value accepted", ' || !["N", "L", "H"].includes(seen[0]!))', ")"],
  ["N read as affected", 'any ||= seen[0] !== "N";', "any ||= true;"],
  ["an unreadable metric read as affected", "if (typeof result === \"string\") return { unreadable:", "if (typeof result === \"string\") continue; if (false) return { unreadable:"],
  ["with no vector, a CWE with several classes decides its strongest", "for (const l of inTable) if (l.classes.length === 1 && ", "for (const l of inTable) if ("],
  ["with no vector, a CWE with several classes never blocks", "const open = inTable.find(l => l.classes.length > 1 && (!best || rank(l.classes[0]!) < rank(best.cls)));", "const open = undefined as (typeof inTable)[number] | undefined;"],
  ["with no vector, a CWE with several classes blocks a stronger decided class", "(!best || rank(l.classes[0]!) < rank(best.cls)));", "true);"],
  ["the reason names the first CWE", "inTable.find(l => l.classes.includes(best))!.cwe", "inTable[0]!.cwe"],
  ["CWE-22's set loses alter", '[["steal", "alter"], [22,', '[["steal"], [22,'],
  ["authorization's set loses steal and alter", '[["impersonate", "steal", "alter"], [266,', '[["impersonate"], [266,'],
  ["XSS allows steal too", '[["impersonate"], [79,', '[["impersonate", "steal"], [79,'],
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
