// node count.mjs <osv dir> <impact.ts> <impact.ts before> [--stronger]: classify every record of OSV's npm and
// Packagist exports twice and print the counts as JSON (LMR1e-2, docs/decisions/2026-10-31-impact-classes-every-cwe-widened.md):
//   before  the impact.ts before LMR1e-2 (f25d51b, LMR1d's sets);
//   after   the worktree's impact.ts (every CWE with every class its mechanism can give).
// With --stronger it prints instead, one per line (tab-separated), every record whose class moved to a stronger one.
// Runs in Docker only, with --network none. Every record of the exports is counted, so the shares have no interval.
// Each trap's basis (MAL- id, MAL- alias, CWE-506 to 512) is read from the record's own fields, apart from classify(),
// and the run fails if the two disagree on any record. It also fails if a zip's sha256 is not the one fetch.json recorded.
// The earlier count.mjs (LMR1d, three ways with the sets before widening) is in git history at f25d51b, LMR1c's at 0129ba8.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath, beforePath] = process.argv.slice(2);
const { classify, IMPACT_ORDER, CWE_CLASSES, TRAP_CWES } = await import(impactPath);
const { classify: classifyBefore, CWE_CLASSES: BEFORE_CLASSES } = await import(beforePath);
const fetched = JSON.parse(readFileSync(join(dir, "fetch.json"), "utf8"));

const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const rank = c => IMPACT_ORDER.indexOf(c);
const setOf = table => new Map(table.flatMap(([classes, ids]) => ids.map(id => [`CWE-${id}`, classes])));
const SETS = { before: setOf(BEFORE_CLASSES), after: setOf(CWE_CLASSES) };
// The two tables list the same CWEs.
{
  const ids = t => t.flatMap(([, i]) => i).sort((a, b) => a - b).join(",");
  if (ids(BEFORE_CLASSES) !== ids(CWE_CLASSES)) throw new Error("the tables before and after do not list the same CWEs");
}

/** Why a record is unclassified, from the reason classify() gives. */
function why(reason) {
  if (/ lists no CWE in database_specific\.cwe_ids\./.test(reason)) return "no_cwe";
  if (/: no CWE listed \(.*\) is in Ludion's table\./.test(reason)) return "no_cwe_in_table";
  if (/ rules? out every class its CWEs allow /.test(reason)) return "vector_rules_out_every_class";
  if (/, and the record has no CVSS vector to choose\./.test(reason)) return "no_vector_several_classes";
  if (/, so no class can be ruled out\./.test(reason)) return "vector_unreadable";
  if (/^The record has no id\./.test(reason)) return "no_id";
  throw new Error(`unknown reason: ${reason}`);
}

/** Counts for one way of classifying (key: "before" or "after"), over the records given. */
function tally(records, key) {
  const n = records.length;
  const byClass = new Map(IMPACT_ORDER.map(c => [c, 0])), reasons = new Map(), ruledOutSingle = new Map();
  for (const r of records) {
    const c = r[key];
    bump(byClass, c.class);
    if (c.class !== "unclassified") continue;
    const reason = why(c.reason);
    bump(reasons, reason);
    // A record whose CWEs together allow one class, which the vector ruled out: counted under that class.
    if (reason === "vector_rules_out_every_class") {
      const union = new Set(c.cwes.flatMap(cwe => SETS[key].get(cwe) ?? []));
      if (union.size === 1) bump(ruledOutSingle, [...union][0]);
    }
  }
  const classified = n - byClass.get("unclassified");
  return {
    records: n,
    classified: { count: classified, pct: pct(classified, n) },
    by_class: Object.fromEntries([...byClass].map(([c, k]) => [c, { count: k, pct: pct(k, n) }])),
    unclassified_by_reason: Object.fromEntries(["vector_rules_out_every_class", "no_vector_several_classes", "no_cwe_in_table", "no_cwe", "vector_unreadable", "no_id"].map(k => [k, reasons.get(k) ?? 0])),
    ruled_out_by_vector_with_one_class: Object.fromEntries(["takeover", "impersonate", "steal", "alter", "disrupt"].map(c => [c, ruledOutSingle.get(c) ?? 0])),
  };
}

/** From → to counts, with how many went to a stronger and to a weaker class. */
function changes(records) {
  const matrix = new Map();
  let changed = 0, stronger = 0, weaker = 0, fromUnclassified = 0, toUnclassified = 0;
  for (const r of records) {
    const a = r.before.class, b = r.after.class;
    if (a === b) continue;
    changed++;
    if (rank(b) < rank(a)) stronger++; else weaker++;
    if (a === "unclassified") fromUnclassified++;
    if (b === "unclassified") toUnclassified++;
    bump(matrix, `${a} -> ${b}`);
  }
  return {
    changed, to_stronger: stronger, to_weaker: weaker, from_unclassified: fromUnclassified, to_unclassified: toUnclassified,
    by_class: Object.fromEntries([...matrix].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  };
}

const all = [], stronger = [];
const out = {
  fetched,
  zips_checked: {},
  tables: { before: BEFORE_CLASSES.map(([classes, ids]) => ({ classes, cwes: ids.length })), after: CWE_CLASSES.map(([classes, ids]) => ({ classes, cwes: ids.length })) },
  ecosystems: {},
};
const summarise = records => {
  const notMal = records.filter(r => !r.mal);
  const none = notMal.filter(r => !r.vectors).length;
  return {
    not_mal: { before: tally(notMal, "before"), after: tally(notMal, "after") },
    changes_not_mal: changes(notMal),
    vectors_not_mal: { records: notMal.length, with_no_cvss_3_or_4_vector: { count: none, pct: pct(none, notMal.length) } },
  };
};
for (const ecosystem of ["npm", "Packagist"]) {
  const zip = join(dir, `${ecosystem}.zip`);
  const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
  if (sha256 !== fetched[ecosystem].sha256) throw new Error(`${zip}: sha256 ${sha256}, fetch.json says ${fetched[ecosystem].sha256}`);
  out.zips_checked[ecosystem] = sha256;
  const records = [];
  for (const [name, text] of entries(zip)) {
    let record;
    try { record = JSON.parse(text); } catch { throw new Error(`${ecosystem}.zip ${name}: not JSON`); }
    const after = classify(record), before = classifyBefore(record);
    const id = typeof record.id === "string" ? record.id : "";
    const cweIds = Array.isArray(record.database_specific?.cwe_ids) ? record.database_specific.cwe_ids : [];
    const listsCwe = n => cweIds.some(e => typeof e === "string" && new RegExp(`^CWE-${n}$`, "i").test(e.trim()));
    const basis = !id ? null
      : id.startsWith("MAL-") ? "id"
      : Array.isArray(record.aliases) && record.aliases.some(a => typeof a === "string" && a.startsWith("MAL-")) ? "alias"
      : TRAP_CWES.some(listsCwe) ? "cwe_506_512"
      : null;
    for (const c of [after, before]) if ((basis !== null) !== (c.class === "trap")) throw new Error(`${ecosystem}.zip ${name}: classify() says ${c.class}, the record's fields say ${basis ?? "not trap"}`);
    const vectors = (Array.isArray(record.severity) ? record.severity : []).filter(s => s?.type === "CVSS_V3" || s?.type === "CVSS_V4").map(s => String(s.score));
    const r = { id, ecosystem, before, after, mal: id.startsWith("MAL-"), vectors: vectors.length ? vectors : null };
    if (!r.mal && rank(after.class) < rank(before.class)) stronger.push([id, ecosystem, before.class, after.class, after.cwes.join(",") || "-", vectors.join(" ; ") || "-"]);
    records.push(r);
  }
  for (const r of records) all.push(r);
  out.ecosystems[ecosystem] = summarise(records);
}
out.ecosystems.both = summarise(all);
if (process.argv.includes("--stronger")) {
  console.log(["id", "ecosystem", "before", "after", "cwes", "cvss"].join("\t"));
  for (const row of stronger.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) console.log(row.join("\t"));
} else {
  out.stronger = stronger.length;
  out.stronger_records = "stronger.tsv (count.sh --stronger)";
  console.log(JSON.stringify(out, null, 2));
}
