// node mutate.mjs (in /w, from mutate.sh): each mutation changes impact.ts once, one at a time; impact.test.ts must fail with it and
// pass without it. Edits use split/join, so no replacement pattern is expanded.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const file = "packages/cli/src/security/impact.ts";
const original = readFileSync(file, "utf8");
const mutations = [
  ["MAL- is not trap", 'id.startsWith("MAL-")', 'id.startsWith("MAL-X")'],
  ["MAL- anywhere in the id is trap", 'id.startsWith("MAL-")', 'id.includes("MAL-")'],
  // LMR1's three on the table, as the code reads since LMR1d: the record's union of classes, strongest first.
  ["the weakest class wins", "[...new Set(classes)].sort((a, b) => rank(a) - rank(b))", "[...new Set(classes)].sort((a, b) => rank(b) - rank(a))"],
  ["the first CWE's classes come first", "[...new Set(classes)].sort((a, b) => rank(a) - rank(b))", "[...new Set(classes)]"],
  ["CWE-78 leaves the table", "73, 77, 78, 94, 95,", "73, 77, 94, 95,"],
  // LMR1c: each CWE's set of classes, and the CVSS vectors that choose among them.
  ["the vectors are not read", "const read = vectors(record as Record<string, unknown>);", "const read = { affects: [] } as { affects: Affects[] };"],
  ["the weakest consistent class wins", "return allowed.find(cls => affects.every(CONSISTENT[cls]));", "return allowed.findLast(cls => affects.every(CONSISTENT[cls]));"],
  ["one consistent vector is enough", "affects.every(CONSISTENT[cls])", "affects.some(CONSISTENT[cls])"],
  ["steal needs no confidentiality", "steal: v => v.c,", "steal: () => true,"],
  ["alter read from confidentiality", "alter: v => v.i,", "alter: v => v.c,"],
  ["disrupt needs no availability", "disrupt: v => v.a,", "disrupt: () => true,"],
  // LMR1d: no stronger class's condition follows from a weaker one's.
  ["impersonate by C or I (nested)", "impersonate: v => v.c && v.i,", "impersonate: v => v.c || v.i,"],
  ["impersonate by C only", "impersonate: v => v.c && v.i,", "impersonate: v => v.c,"],
  ["takeover by any of C, I and A (nested)", "takeover: v => v.full,", "takeover: v => v.c || v.i || v.a,"],
  ["takeover by C and I not N", "takeover: v => v.full,", "takeover: v => v.c && v.i,"],
  ["takeover from C:H alone", 'values.get(ck)![0] === "H" && values.get(ik)![0] === "H"', 'values.get(ck)![0] === "H"'],
  ["takeover from C:H and I:H of different systems", 'systems: [["VC", "VI"], ["SC", "SI"]]', 'systems: [["VC", "VI"], ["SC", "SI"], ["VC", "SI"]]'],
  ["takeover not from CVSS 4's subsequent system", 'systems: [["VC", "VI"], ["SC", "SI"]]', 'systems: [["VC", "VI"]]'],
  ["the table argument ignored", "const sets = lookup(table);", "const sets = lookup(CWE_CLASSES);"],
  ["with no vector, the strongest of several classes", "return allowed.length === 1 ? allowed[0] : undefined;", "return allowed[0];"],
  // LMR1e: the step that chooses, exported for the tests.
  ["chooseClass does not sort the set", "return choose(byStrength(set), read.affects)", "return choose([...set], read.affects)"],
  ["chooseClass reads an unreadable vector as none", 'if ("unreadable" in read) return "unclassified";', 'if ("unreadable" in read) return choose(byStrength(set), []) ?? "unclassified";'],
  ["chooseClass ignores the vectors", "return choose(byStrength(set), read.affects)", "return choose(byStrength(set), [])"],
  ["CVSS 4's subsequent systems not read", 'c: ["VC", "SC"], i: ["VI", "SI"], a: ["VA", "SA"]', 'c: ["VC"], i: ["VI"], a: ["VA"]'],
  ["a vector of another version accepted", "prefix: /^CVSS:3\\.[01]\\//", "prefix: /^CVSS:/"],
  ["a score of another form skipped", "if (typeof score !== \"string\" || !spec.prefix.test(score)) return", "if (typeof score !== \"string\" || !spec.prefix.test(score)) continue; if (false) return"],
  ["a metric given twice accepted", "if (seen.length !== 1 ||", "if (seen.length < 1 ||"],
  ["any metric value accepted", ' || !["N", "L", "H"].includes(seen[0]!))', ")"],
  ["N read as affected", 'any ||= seen[0] !== "N";', "any ||= true;"],
  ["an unreadable metric read as affected", "if (typeof result === \"string\") return { unreadable:", "if (typeof result === \"string\") continue; if (false) return { unreadable:"],
  ["the reason names the first CWE", "inTable.find(l => l.classes.includes(best))!.cwe", "inTable[0]!.cwe"],
  // LMR1e-2: every CWE with every class its mechanism can give.
  ["path traversal and code injection lose alter", '[["takeover", "steal", "alter", "disrupt"], [22,', '[["takeover", "steal", "disrupt"], [22,'],
  ["path traversal and code injection lose disrupt", '[["takeover", "steal", "alter", "disrupt"], [22,', '[["takeover", "steal", "alter"], [22,'],
  ["the login and authorization set loses steal, alter and disrupt", '[["impersonate", "steal", "alter", "disrupt"], [79,', '[["impersonate"], [79,'],
  ["CSRF can steal", '[["impersonate", "alter", "disrupt"], [352]]', '[["impersonate", "steal", "alter", "disrupt"], [352]]'],
  ["the five-class row loses impersonate", '[["takeover", "impersonate", "steal", "alter", "disrupt"], [15,', '[["takeover", "steal", "alter", "disrupt"], [15,'],
  ["SSRF and XXE lose disrupt", '[["steal", "alter", "disrupt"], [611, 918]]', '[["steal", "alter"], [611, 918]]'],
  ["out-of-bounds reads lose disrupt", '[["steal", "disrupt"], [125,', '[["steal"], [125,'],
  ["CWE-912 leaves the table", "434, 912, 943,", "434, 943,"],
  // LMR1b: trap as a published record, and stops with their reasons; LMR1d: CWE-506 to 512.
  ["a MAL- alias is not trap", "if (malAlias) return", "if (false && malAlias) return"],
  ["an alias containing MAL- anywhere is trap", 'alias.startsWith("MAL-")', 'alias.includes("MAL-")'],
  ["no CWE makes a trap", "const trapCwe = TRAP_CWES.find(n => numbers.has(n));", "const trapCwe = undefined as number | undefined;"],
  ["only CWE-506 makes a trap", "[506, 507, 508, 509, 510, 511, 512]", "[506]"],
  ["CWE-912 is trap too", "[506, 507, 508, 509, 510, 511, 512]", "[506, 507, 508, 509, 510, 511, 512, 912]"],
  ["a trap stop is accepted without its record classifying as trap", 'if (c.class !== "trap") throw', "if (false) throw"],
  ["every stop is counted as a trap", "unverified.set(stop.reason, (unverified.get(stop.reason) ?? 0) + 1);", "traps++;"],
  ["traps are counted as unverified", "traps++;", 'unverified.set("undecidable", (unverified.get("undecidable") ?? 0) + 1);'],
  ["a stopped row with no reason is accepted", "throw new Error(`Row ${i}: a stopped row needs its reason`);", 'did = "";'],
  ["a stop reason on another action is accepted", "if (stop != null) throw", "if (false) throw"],
  ["an unknown stop reason is accepted", "} else if (STOP_REASONS.includes(stop.reason)) {", "} else if (true) {"],
  ["stop reasons counted in the order given", "const reasons = STOP_REASONS.filter(r => unverified.has(r));", "const reasons = [...unverified.keys()];"],
  ["the reasons left out of the summary", "`${l.unverified} ${total}${l.reasons(reasons.map(r => `${l.stop[r]} ${unverified.get(r)}`).join(l.join))}`", "`${l.unverified} ${total}`"],
  ["the trap cell without the record's id", "did = l.trapCell(codeSpan((stop.record as { id: string }).id));", 'did = l.trapCell("");'],
  // LMR1c-2 replaced "the record's id not escaped" by "a trap's record id not checked": an id must now have an id's
  // form, which holds no character the code span would escape, so that mutation no longer changes any output.
  ["the Japanese unverified label shortened", 'unverified: "確かめられなかったので止めた",', 'unverified: "止めた",'],
  ["cwe_ids not read", "Array.isArray(specific.cwe_ids) ? specific.cwe_ids : []", "[]"],
  ["any severity string kept", "(SEVERITIES as readonly string[]).includes(raw) ? (raw as Severity) : \"unknown\"", "(raw || \"unknown\") as Severity"],
  // LMR1c-3: code spans refuse \, | and line breaks instead of escaping them (ludion-ops#1 comment 6539943852 (b)), so
  // LMR1's "| not escaped" and "line breaks kept" and LMR1c-2's two escaping mutations became one per refused character.
  ["fence not lengthened", "Math.max(0, ...[...text.matchAll(/`+/g)].map(m => m[0].length)) + 1", "1"],
  ["minutes rounded, not floored", "Math.floor((acted - instant", "Math.round((acted - instant"],
  ["action before the fix accepted", "if (minutes < 0) throw", "if (minutes < -1e12) throw"],
  ["Feb 30 accepted", "new Date(at).toISOString().slice(0, 19) !== match[1]", "false"],
  ["summary counts every action as fixed", "`${l.count[a]} ${counts.get(a)}`", "`${l.count.fixed} ${counts.get(a)}`"],
  // LMR1c-2: strict forms for every shown value. LMR1c-3: a code span refuses \, | and line breaks.
  ["a code span accepts \\", String.raw`/[\\|\r\n\u{2028}\u{2029}]/u.test(text)`, String.raw`/[|\r\n\u{2028}\u{2029}]/u.test(text)`],
  ["a code span accepts |", String.raw`/[\\|\r\n\u{2028}\u{2029}]/u.test(text)`, String.raw`/[\\\r\n\u{2028}\u{2029}]/u.test(text)`],
  ["a code span accepts CR", String.raw`/[\\|\r\n\u{2028}\u{2029}]/u.test(text)`, String.raw`/[\\|\n\u{2028}\u{2029}]/u.test(text)`],
  ["a code span accepts LF", String.raw`/[\\|\r\n\u{2028}\u{2029}]/u.test(text)`, String.raw`/[\\|\r\u{2028}\u{2029}]/u.test(text)`],
  ["a code span accepts U+2028", String.raw`/[\\|\r\n\u{2028}\u{2029}]/u.test(text)`, String.raw`/[\\|\r\n\u{2029}]/u.test(text)`],
  ["a code span accepts U+2029", String.raw`/[\\|\r\n\u{2028}\u{2029}]/u.test(text)`, String.raw`/[\\|\r\n\u{2028}]/u.test(text)`],
  ["a code span escapes |", "if (/[\\\\|\\r\\n\\u{2028}\\u{2029}]/u.test(text)) throw", 'text = text.replace(/\\|/g, "\\\\|"); if (/[\\r\\n\\u{2028}\\u{2029}]/u.test(text)) throw'],
  ["the strict form not checked", "if (!readable(row)) {", "if (false) {"],
  ["unreadable rows not counted", "unreadable++;", ""],
  ["the unreadable note left out", "const note = unreadable ? [l.unreadable(unreadable)] : [];", "const note: string[] = [];"],
  ["the npm form for every ecosystem", "NAMES[ecosystem as RecordEcosystem].test(row.package)", "NAMES.npm.test(row.package)"],
  ["an ecosystem that is not a string accepted", 'typeof ecosystem !== "string" || ', ""],
  ["the name limit dropped", "row.package.length > NAME_LIMIT || ", ""],
  ["from not checked", "!VERSION.test(row.from) || ", ""],
  ["to not checked", "!VERSION.test(row.to)) return false;", "false) return false;"],
  ["the class list not checked", "if (!IMPACT_ORDER.includes(row.class) || ", "if ("],
  ["the severity list not checked", '(row.severity !== "unknown" && !SEVERITIES.includes(row.severity))', "false"],
  ["Composer names with capitals accepted", "(?:(?:[_.]|-{1,2})[a-z0-9]+)*$/,", "(?:(?:[_.]|-{1,2})[a-z0-9]+)*$/i,"],
  ["a trap's record id not checked", 'return !(isObject(record) && typeof record.id === "string" && !RECORD_ID.test(record.id));', "return true;"],
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
