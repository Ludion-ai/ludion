// node count.mjs <osv dir> <impact.ts> <impact.ts of LMR1e-2> <impact.ts of LMR1d> [--stronger]: classify every record
// of OSV's npm and Packagist exports three times and print the counts as JSON (LMR1f,
// docs/decisions/2026-10-31-impact-classes-takeover-direct.md, "Measured with it"):
//   lmr1d   the impact.ts of f25d51b (LMR1d's sets, the "before" of LMR1e-2's count);
//   lmr1e2  the impact.ts of 42e30b6 (every CWE widened, takeover through a further step too);
//   after   the worktree's impact.ts (takeover only where code running is the direct result of the mechanism).
// With --stronger it prints instead, one per line (tab-separated), every record whose class moved to a stronger one
// from lmr1d or from lmr1e2 to after, with which comparison it is.
// Runs in Docker only, with --network none. Every record of the exports is counted, so the shares have no interval.
// Each trap's basis (MAL- id, MAL- alias, CWE-506 to 512) is read from the record's own fields, apart from classify(),
// and the run fails if it and any of the three disagree on any record. It also fails if a zip's sha256 is not the one
// fetch.json recorded. The earlier count.mjs (LMR1e-2, two ways) is in git history at 42e30b6, LMR1d's at f25d51b.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath, lmr1e2Path, lmr1dPath] = process.argv.slice(2);
const after = await import(impactPath), lmr1e2 = await import(lmr1e2Path), lmr1d = await import(lmr1dPath);
const { IMPACT_ORDER, TRAP_CWES } = after;
const WAYS = { lmr1d, lmr1e2, after };
const PAIRS = [["lmr1e2", "after"], ["lmr1d", "after"]];
const fetched = JSON.parse(readFileSync(join(dir, "fetch.json"), "utf8"));

const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const rank = c => IMPACT_ORDER.indexOf(c);
const setOf = table => new Map(table.flatMap(([classes, ids]) => ids.map(id => [`CWE-${id}`, classes])));
const SETS = Object.fromEntries(Object.entries(WAYS).map(([k, m]) => [k, setOf(m.CWE_CLASSES)]));
// The three tables list the same CWEs.
{
  const ids = t => t.flatMap(([, i]) => i).sort((a, b) => a - b).join(",");
  for (const [k, m] of Object.entries(WAYS)) if (ids(m.CWE_CLASSES) !== ids(after.CWE_CLASSES)) throw new Error(`the table of ${k} does not list the same CWEs as after`);
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

/** Counts for one way of classifying, over the records given. */
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

/** From → to counts, with how many went to a stronger and to a weaker class, and the moves to takeover apart. */
function changes(records, from, to) {
  const matrix = new Map(), toTakeover = new Map();
  let changed = 0, stronger = 0, weaker = 0, fromUnclassified = 0, toUnclassified = 0;
  for (const r of records) {
    const a = r[from].class, b = r[to].class;
    if (a === b) continue;
    changed++;
    if (rank(b) < rank(a)) stronger++; else weaker++;
    if (a === "unclassified") fromUnclassified++;
    if (b === "unclassified") toUnclassified++;
    if (b === "takeover") bump(toTakeover, a);
    bump(matrix, `${a} -> ${b}`);
  }
  const takeoverTotal = [...toTakeover.values()].reduce((s, k) => s + k, 0);
  return {
    changed, to_stronger: stronger, to_weaker: weaker, from_unclassified: fromUnclassified, to_unclassified: toUnclassified,
    to_takeover: { count: takeoverTotal, by_class_before: Object.fromEntries([...toTakeover].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) },
    by_class: Object.fromEntries([...matrix].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  };
}

const all = [], stronger = [];
const out = {
  fetched,
  zips_checked: {},
  tables: Object.fromEntries(Object.entries(WAYS).map(([k, m]) => [k, m.CWE_CLASSES.map(([classes, ids]) => ({ classes, cwes: ids.length }))])),
  ecosystems: {},
};
const summarise = records => {
  const notMal = records.filter(r => !r.mal);
  const none = notMal.filter(r => !r.vectors).length;
  return {
    not_mal: Object.fromEntries(Object.keys(WAYS).map(k => [k, tally(notMal, k)])),
    changes_not_mal: Object.fromEntries(PAIRS.map(([a, b]) => [`${a}_to_${b}`, changes(notMal, a, b)])),
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
    const id = typeof record.id === "string" ? record.id : "";
    const r = { id, ecosystem, mal: id.startsWith("MAL-") };
    for (const [k, m] of Object.entries(WAYS)) r[k] = m.classify(record);
    const cweIds = Array.isArray(record.database_specific?.cwe_ids) ? record.database_specific.cwe_ids : [];
    const listsCwe = n => cweIds.some(e => typeof e === "string" && new RegExp(`^CWE-${n}$`, "i").test(e.trim()));
    const basis = !id ? null
      : id.startsWith("MAL-") ? "id"
      : Array.isArray(record.aliases) && record.aliases.some(a => typeof a === "string" && a.startsWith("MAL-")) ? "alias"
      : TRAP_CWES.some(listsCwe) ? "cwe_506_512"
      : null;
    for (const k of Object.keys(WAYS)) if ((basis !== null) !== (r[k].class === "trap")) throw new Error(`${ecosystem}.zip ${name}: ${k}'s classify() says ${r[k].class}, the record's fields say ${basis ?? "not trap"}`);
    const vectors = (Array.isArray(record.severity) ? record.severity : []).filter(s => s?.type === "CVSS_V3" || s?.type === "CVSS_V4").map(s => String(s.score));
    r.vectors = vectors.length ? vectors : null;
    if (!r.mal) for (const [a, b] of PAIRS) if (rank(r[b].class) < rank(r[a].class)) stronger.push([`${a}_to_${b}`, id, ecosystem, r[a].class, r[b].class, r[b].cwes.join(",") || "-", vectors.join(" ; ") || "-"]);
    records.push(r);
  }
  for (const r of records) all.push(r);
  out.ecosystems[ecosystem] = summarise(records);
}
out.ecosystems.both = summarise(all);
if (process.argv.includes("--stronger")) {
  console.log(["comparison", "id", "ecosystem", "before", "after", "cwes", "cvss"].join("\t"));
  for (const row of stronger.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))) console.log(row.join("\t"));
} else {
  out.stronger = Object.fromEntries(PAIRS.map(([a, b]) => [`${a}_to_${b}`, stronger.filter(row => row[0] === `${a}_to_${b}`).length]));
  out.stronger_records = "stronger.tsv (count.sh --stronger)";
  console.log(JSON.stringify(out, null, 2));
}
