// node count.mjs <osv dir> <impact.ts> <impact.ts before LMR1d> [--stronger]: classify every record of OSV's npm and
// Packagist exports three times and print the counts as JSON (LMR1d, docs/decisions/2026-10-31-impact-classes-conditions-and-sets.md):
//   before  the impact.ts before LMR1d (0129ba8, LMR1c);
//   narrow  the new classify() with the sets before widening (comment 6539943852 (a) alone, NARROW below);
//   wide    the new classify() with the table it ships (comment 6540209072, item 4).
// With --stronger it prints instead, one per line (tab-separated), every record whose class moved to a stronger one.
// Runs in Docker only, with --network none. Every record of the exports is counted, so the shares have no interval.
// Each trap's basis (MAL- id, MAL- alias, CWE-506 to 512) is read from the record's own fields, apart from classify(),
// and the run fails if the two disagree on any record. It also fails if a zip's sha256 is not the one fetch.json recorded.
// The earlier count.mjs (LMR1c) is in git history at 0129ba8.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath, beforePath] = process.argv.slice(2);
const { classify, IMPACT_ORDER, CWE_CLASSES, TRAP_CWES } = await import(impactPath);
const { classify: classifyBefore } = await import(beforePath);
const fetched = JSON.parse(readFileSync(join(dir, "fetch.json"), "utf8"));

// The sets before widening, as the decision record writes them: LMR1c's sets with 912 → {takeover}, 79 →
// {impersonate, steal, alter}, and 59, 73, 276, 732 → {steal, alter}.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const NARROW = [
  [["takeover"], [77, 78, 94, 95, 96, 98, 434, 494, 502, 829, 912, 917, 1336]],
  [["impersonate", "steal", "alter"], [79, 266, 269, 284, 285, 425, 639, 862, 863]],
  [["impersonate"], [80, ...range(83, 87), ...range(287, 290), 294, 302, 303, ...range(305, 307), 352, 384, 601, 613, 620, 640, 798, ...range(1390, 1393)]],
  [["steal", "alter"], [...range(22, 40), 59, 73, 89, 276, 552, 732, 943]],
  ...CWE_CLASSES.filter(([classes]) => classes.length === 1),
];
// Every CWE of the shipped table is in NARROW and the other way round.
{
  const ids = t => t.flatMap(([, i]) => i).sort((a, b) => a - b).join(",");
  if (ids(NARROW) !== ids(CWE_CLASSES)) throw new Error("NARROW and CWE_CLASSES do not list the same CWEs");
}

const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const rank = c => IMPACT_ORDER.indexOf(c);
const setOf = table => new Map(table.flatMap(([classes, ids]) => ids.map(id => [`CWE-${id}`, classes])));
const SETS = { narrow: setOf(NARROW), wide: setOf(CWE_CLASSES) };

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

/** Counts for one way of classifying (key: "narrow" or "wide"), over the records given. */
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
    unclassified_by_reason: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])),
    ruled_out_by_vector_with_one_class: Object.fromEntries(["takeover", "impersonate", "steal", "alter", "disrupt"].map(c => [c, ruledOutSingle.get(c) ?? 0])),
  };
}

/** From → to counts between two ways of classifying, with how many went to a stronger and to a weaker class. */
function changes(records, from, to) {
  const matrix = new Map();
  let changed = 0, stronger = 0, weaker = 0, newlyClassified = 0, newlyUnclassified = 0;
  for (const r of records) {
    const a = r[from].class, b = r[to].class;
    if (a === b) continue;
    changed++;
    if (rank(b) < rank(a)) stronger++; else weaker++;
    if (a === "unclassified") newlyClassified++;
    if (b === "unclassified") newlyUnclassified++;
    bump(matrix, `${a} -> ${b}`);
  }
  return {
    changed, to_stronger: stronger, to_weaker: weaker, from_unclassified: newlyClassified, to_unclassified: newlyUnclassified,
    by_class: Object.fromEntries([...matrix].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  };
}

function vectorShare(records) {
  const none = records.filter(r => !r.vectors).length;
  return { records: records.length, with_no_cvss_3_or_4_vector: { count: none, pct: pct(none, records.length) } };
}

const all = [], stronger = [];
const out = {
  fetched,
  zips_checked: {},
  tables: { narrow: NARROW.map(([classes, ids]) => ({ classes, cwes: ids.length })), wide: CWE_CLASSES.map(([classes, ids]) => ({ classes, cwes: ids.length })) },
  ecosystems: {},
};
const summarise = records => {
  const notMal = records.filter(r => !r.mal);
  return {
    not_mal: { before_lmr1d: { classified: { count: notMal.filter(r => r.before.class !== "unclassified").length, pct: pct(notMal.filter(r => r.before.class !== "unclassified").length, notMal.length) } }, narrow: tally(notMal, "narrow"), wide: tally(notMal, "wide") },
    changes_not_mal: { before_to_narrow: changes(notMal, "before", "narrow"), before_to_wide: changes(notMal, "before", "wide"), narrow_to_wide: changes(notMal, "narrow", "wide") },
    vectors_not_mal: vectorShare(notMal),
    trap_not_mal: { before_lmr1d: notMal.filter(r => r.before.class === "trap").length, now: notMal.filter(r => r.wide.class === "trap").length, by_basis: Object.fromEntries(["alias", "cwe_506", "cwe_507_512"].map(b => [b, notMal.filter(r => r.basis === b).length])) },
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
    const wide = classify(record), narrow = classify(record, NARROW), before = classifyBefore(record);
    const id = typeof record.id === "string" ? record.id : "";
    const cweIds = Array.isArray(record.database_specific?.cwe_ids) ? record.database_specific.cwe_ids : [];
    const listsCwe = n => cweIds.some(e => typeof e === "string" && new RegExp(`^CWE-${n}$`, "i").test(e.trim()));
    const basis = !id ? null
      : id.startsWith("MAL-") ? "id"
      : Array.isArray(record.aliases) && record.aliases.some(a => typeof a === "string" && a.startsWith("MAL-")) ? "alias"
      : listsCwe(506) ? "cwe_506"
      : TRAP_CWES.some(n => n !== 506 && listsCwe(n)) ? "cwe_507_512"
      : null;
    for (const c of [wide, narrow]) if ((basis !== null) !== (c.class === "trap")) throw new Error(`${ecosystem}.zip ${name}: classify() says ${c.class}, the record's fields say ${basis ?? "not trap"}`);
    // Trap changes only by CWE-507 to 512.
    if ((before.class === "trap") !== (wide.class === "trap") && basis !== "cwe_507_512") throw new Error(`${ecosystem}.zip ${name}: trap changed (${before.class} -> ${wide.class}) not by CWE-507 to 512`);
    const vectors = (Array.isArray(record.severity) ? record.severity : []).filter(s => s?.type === "CVSS_V3" || s?.type === "CVSS_V4").map(s => String(s.score));
    const r = { id, ecosystem, before, narrow, wide, basis, mal: id.startsWith("MAL-"), vectors: vectors.length ? vectors : null };
    for (const [from, to] of [["before", "narrow"], ["before", "wide"], ["narrow", "wide"]]) {
      if (!r.mal && rank(r[to].class) < rank(r[from].class)) stronger.push([`${from}->${to}`, id, ecosystem, r[from].class, r[to].class, wide.cwes.join(",") || "-", vectors.join(" ; ") || "-"]);
    }
    records.push(r);
  }
  for (const r of records) all.push(r);
  out.ecosystems[ecosystem] = summarise(records);
}
out.ecosystems.both = summarise(all);
if (process.argv.includes("--stronger")) {
  console.log(["between", "id", "ecosystem", "from", "to", "cwes", "cvss"].join("\t"));
  for (const row of stronger.sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1))) console.log(row.join("\t"));
} else {
  out.stronger = Object.fromEntries(["before->narrow", "before->wide", "narrow->wide"].map(k => [k, stronger.filter(s => s[0] === k).length]));
  out.stronger_records = "stronger.tsv (count.sh --stronger)";
  console.log(JSON.stringify(out, null, 2));
}
