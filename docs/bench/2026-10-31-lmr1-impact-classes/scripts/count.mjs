// node count.mjs <osv dir> <impact.ts> <impact.ts before LMR1c>: classify every record of OSV's npm and Packagist exports
// with Ludion's classify(), now and before LMR1c, and print the counts as JSON. Runs in Docker only, with --network none.
// These are all the records of the exports, not a sample, so the shares are plain percentages with no interval.
// Each trap's basis (MAL- id, MAL- alias, CWE-506) is read from the record's own fields, apart from classify(), and the
// run fails if the two disagree on any record. It also fails if a zip's sha256 is not the one fetch.json recorded.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath, beforePath] = process.argv.slice(2);
const { classify, IMPACT_ORDER, CWE_CLASSES, DECIDED_UNCLASSIFIED } = await import(impactPath);
const { classify: classifyBefore } = await import(beforePath);
const fetched = JSON.parse(readFileSync(join(dir, "fetch.json"), "utf8"));

const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const setsOf = new Map(CWE_CLASSES.flatMap(([classes, ids]) => ids.map(id => [`CWE-${id}`, classes])));
// Decided unclassified for "read or written" (decision record, "Not changed here"): how many unclassified records name each.
const NAMED = ["CWE-59", "CWE-73", "CWE-276", "CWE-732"];

/** The record's CVSS 3 and 4 vectors as count.mjs reads them itself: per type, whether C, I and A are each not N. */
function vectorsOf(record) {
  const out = { v3: [], v4: [] };
  for (const s of Array.isArray(record.severity) ? record.severity : []) {
    if (s?.type !== "CVSS_V3" && s?.type !== "CVSS_V4") continue;
    const m = new Map(String(s.score).split("/").slice(1).map(p => p.split(":")));
    const notN = keys => keys.some(k => m.get(k) !== "N");
    if (s.type === "CVSS_V3") out.v3.push({ c: notN(["C"]), i: notN(["I"]), a: notN(["A"]) });
    else out.v4.push({ c: notN(["VC", "SC"]), i: notN(["VI", "SI"]), a: notN(["VA", "SA"]) });
  }
  return out;
}

/** Why a record is unclassified, from the reason classify() gives. */
function why(reason) {
  if (/ lists no CWE in database_specific\.cwe_ids\./.test(reason)) return "no_cwe";
  if (/: no CWE listed \(.*\) is in Ludion's table\./.test(reason)) return "no_cwe_in_table";
  if (/ rules? out every class its CWEs allow /.test(reason)) return "vector_rules_out_every_class";
  if (/ and the record has no CVSS vector to choose\./.test(reason)) return "no_vector_to_choose";
  if (/, so no class can be ruled out\./.test(reason)) return "vector_unreadable";
  if (/^The record has no id\./.test(reason)) return "no_id";
  throw new Error(`unknown reason: ${reason}`);
}

function tally(records) {
  const n = records.length;
  const byClass = new Map(IMPACT_ORDER.map(c => [c, 0])), before = new Map(IMPACT_ORDER.map(c => [c, 0]));
  const bySeverity = new Map(), unclassifiedCwes = new Map(), unclassifiedWhy = new Map(), named = new Map(NAMED.map(c => [c, 0]));
  const trapBy = { id: 0, alias: 0, cwe_506: 0 };
  let withCwe = 0, mal = 0, withdrawn = 0, unclassifiedWithCwe = 0;
  for (const r of records) {
    bump(byClass, r.class);
    bump(before, r.before);
    bump(bySeverity, r.severity);
    if (r.cwes.length) withCwe++;
    if (r.mal) mal++;
    if (r.withdrawn) withdrawn++;
    if (r.basis) trapBy[r.basis]++;
    if (r.class === "unclassified") {
      bump(unclassifiedWhy, why(r.reason));
      if (r.cwes.length) {
        unclassifiedWithCwe++;
        for (const cwe of r.cwes) bump(unclassifiedCwes, cwe);
      }
      for (const cwe of NAMED) if (r.cwes.includes(cwe)) bump(named, cwe);
    }
  }
  const classified = n - byClass.get("unclassified"), classifiedBefore = n - before.get("unclassified");
  const notTrap = n - byClass.get("trap"), byTable = classified - byClass.get("trap");
  return {
    records: n,
    mal,
    withdrawn,
    with_cwe: withCwe,
    classified: { count: classified, pct: pct(classified, n) },
    classified_before_lmr1c: { count: classifiedBefore, pct: pct(classifiedBefore, n) },
    trap_by: trapBy,
    // How many records the CWE table gives a class: those that are not trap, classified by their CWEs.
    not_trap_classified_by_table: { count: byTable, of: notTrap, pct: pct(byTable, notTrap) },
    by_class: Object.fromEntries([...byClass].map(([c, k]) => [c, { count: k, pct: pct(k, n), before_lmr1c: before.get(c) }])),
    by_severity: Object.fromEntries([...bySeverity].sort((a, b) => b[1] - a[1])),
    unclassified_by_reason: Object.fromEntries([...unclassifiedWhy].sort((a, b) => b[1] - a[1])),
    unclassified_with_cwe: unclassifiedWithCwe,
    // Records counted once per CWE: a record with two such CWEs adds one to each.
    unclassified_top20_cwes: [...unclassifiedCwes].sort((a, b) => b[1] - a[1] || Number(a[0].slice(4)) - Number(b[0].slice(4))).slice(0, 20),
    unclassified_naming: Object.fromEntries(named),
  };
}

/** Old class -> new class, and for each CWE the records listing it whose class changed, by old -> new. */
function changes(records) {
  const matrix = new Map(), byCwe = new Map();
  let changed = 0;
  for (const r of records) {
    if (r.before === r.class) continue;
    changed++;
    const key = `${r.before} -> ${r.class}`;
    bump(matrix, key);
    for (const cwe of r.cwes) {
      if (!byCwe.has(cwe)) byCwe.set(cwe, new Map());
      bump(byCwe.get(cwe), key);
    }
  }
  const total = m => [...m.values()].reduce((a, b) => a + b, 0);
  return {
    changed,
    by_class: Object.fromEntries([...matrix].sort((a, b) => b[1] - a[1])),
    // A record with several CWEs is counted under each of them.
    by_cwe: [...byCwe].sort((a, b) => total(b[1]) - total(a[1]) || Number(a[0].slice(4)) - Number(b[0].slice(4)))
      .map(([cwe, m]) => ({ cwe, changed: total(m), ...Object.fromEntries([...m].sort((a, b) => b[1] - a[1])) })),
  };
}

function vectorShapes(records) {
  const shapes = { none: 0, cvss3_only: 0, cvss4_only: 0, both: 0 };
  const disagree = { c: 0, i: 0, a: 0, any: 0 };
  let wholeSetSeveral = 0;
  for (const r of records) {
    const { v3, v4 } = r.vectors;
    shapes[v3.length && v4.length ? "both" : v3.length ? "cvss3_only" : v4.length ? "cvss4_only" : "none"]++;
    if (v3.length && v4.length) {
      let any = false;
      for (const k of ["c", "i", "a"]) if (v3.some(x => v4.some(y => x[k] !== y[k]))) { disagree[k]++; any = true; }
      if (any) disagree.any++;
    }
    // Classified with no vector although the record's whole set (every class its table CWEs allow) is several classes
    // (decision point 5): these would be unclassified if the whole set had to be one class.
    if (!v3.length && !v4.length && r.class !== "trap" && r.class !== "unclassified") {
      const union = new Set(r.cwes.flatMap(c => setsOf.get(c) ?? []));
      if (union.size > 1) wholeSetSeveral++;
    }
  }
  return { records: records.length, shapes, cvss3_and_4_disagree_on_not_n: disagree, classified_with_no_vector_whose_whole_set_is_several_classes: wholeSetSeveral };
}

const all = [], words = [];
const out = {
  fetched,
  zips_checked: {},
  table: { sets: CWE_CLASSES.map(([classes, ids]) => ({ classes, cwes: ids.length })), mapped_cwes: CWE_CLASSES.flatMap(([, ids]) => ids).length, decided_unclassified: DECIDED_UNCLASSIFIED.length },
  ecosystems: {},
};
const summarise = records => {
  const notMal = records.filter(r => !r.mal);
  return { all: tally(records), not_mal: tally(notMal), not_mal_not_withdrawn: tally(notMal.filter(r => !r.withdrawn)), changes_not_mal: changes(notMal), vectors_not_mal: vectorShapes(notMal) };
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
    const c = classify(record), before = classifyBefore(record);
    const id = typeof record.id === "string" ? record.id : "";
    const cweIds = Array.isArray(record.database_specific?.cwe_ids) ? record.database_specific.cwe_ids : [];
    const basis = !id ? null
      : id.startsWith("MAL-") ? "id"
      : Array.isArray(record.aliases) && record.aliases.some(a => typeof a === "string" && a.startsWith("MAL-")) ? "alias"
      : cweIds.some(e => typeof e === "string" && /^CWE-506$/i.test(e.trim())) ? "cwe_506"
      : null;
    if ((basis !== null) !== (c.class === "trap")) throw new Error(`${ecosystem}.zip ${name}: classify() says ${c.class}, the record's fields say ${basis ?? "not trap"}`);
    if ((c.class === "trap") !== (before.class === "trap")) throw new Error(`${ecosystem}.zip ${name}: trap changed (${before.class} -> ${c.class}), which LMR1c does not change`);
    // A fixed-string search, case ignored: "malware" or "malicious" in the summary or the details.
    const said = `${typeof record.summary === "string" ? record.summary : ""}\n${typeof record.details === "string" ? record.details : ""}`.toLowerCase();
    if (said.includes("malware") || said.includes("malicious")) {
      const packages = (Array.isArray(record.affected) ? record.affected : []).map(a => a?.package?.name).filter(x => typeof x === "string");
      words.push({ id, ecosystem, class: c.class, packages: [...new Set(packages)], cwes: c.cwes, withdrawn: typeof record.withdrawn === "string" });
    }
    records.push({ ...c, before: before.class, basis, mal: id.startsWith("MAL-"), withdrawn: typeof record.withdrawn === "string", vectors: vectorsOf(record) });
  }
  for (const r of records) all.push(r);
  out.ecosystems[ecosystem] = summarise(records);
}
out.ecosystems.both = summarise(all);
const notTrap = words.filter(w => w.class !== "trap").sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
out.malware_or_malicious = {
  search: 'summary or details contains "malware" or "malicious", case ignored (fixed strings)',
  matched: words.length,
  matched_trap: words.length - notTrap.length,
  not_trap: notTrap.length,
  not_trap_by_class: Object.fromEntries(IMPACT_ORDER.filter(c => c !== "trap").map(c => [c, notTrap.filter(w => w.class === c).length])),
  not_trap_records: notTrap,
};
console.log(JSON.stringify(out, null, 2));
