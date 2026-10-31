// node count.mjs <osv dir> <impact.ts>: classify every record of OSV's npm and Packagist exports with Ludion's classify()
// and print the counts as JSON. Runs in Docker only, with --network none.
// LMR1b: each trap's basis (MAL- id, MAL- alias, CWE-506) is read from the record's own fields, apart from classify(),
// and the run fails if the two disagree on any record.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath] = process.argv.slice(2);
const { classify, IMPACT_ORDER, CWE_CLASSES, DECIDED_UNCLASSIFIED } = await import(impactPath);
const fetched = JSON.parse(readFileSync(join(dir, "fetch.json"), "utf8"));

/** Wilson score interval, 95% (z = 1.96), as percentages to one decimal place. */
function wilson(k, n) {
  if (!n) return null;
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  const pct = x => Math.round(x * 1000) / 10;
  return { pct: pct(p), low: pct(Math.max(0, centre - half)), high: pct(Math.min(1, centre + half)) };
}
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

function tally(records) {
  const n = records.length;
  const byClass = new Map(IMPACT_ORDER.map(c => [c, 0]));
  const bySeverity = new Map();
  const unclassifiedCwes = new Map();
  let withCwe = 0, mal = 0, withdrawn = 0, unclassifiedWithCwe = 0, aliasAnd506 = 0;
  const trapBy = { id: 0, alias: 0, cwe_506: 0 };
  for (const r of records) {
    bump(byClass, r.class);
    bump(bySeverity, r.severity);
    if (r.cwes.length) withCwe++;
    if (r.mal) mal++;
    if (r.basis) trapBy[r.basis]++;
    if (r.basis === "alias" && r.cwes.includes("CWE-506")) aliasAnd506++;
    if (r.withdrawn) withdrawn++;
    if (r.class === "unclassified" && r.cwes.length) {
      unclassifiedWithCwe++;
      for (const cwe of r.cwes) bump(unclassifiedCwes, cwe);
    }
  }
  const classified = n - byClass.get("unclassified");
  // The CWE table's own share: records that are not trap, classified by their CWEs.
  const notTrap = n - byClass.get("trap"), byTable = classified - byClass.get("trap");
  return {
    records: n,
    mal,
    withdrawn,
    with_cwe: { count: withCwe, ...wilson(withCwe, n) },
    classified: { count: classified, ...wilson(classified, n) },
    trap_by: { ...trapBy, alias_also_cwe_506: aliasAnd506 },
    not_trap_classified_by_table: { count: byTable, of: notTrap, ...wilson(byTable, notTrap) },
    by_class: Object.fromEntries([...byClass].map(([c, k]) => [c, { count: k, ...wilson(k, n) }])),
    by_severity: Object.fromEntries([...bySeverity].sort((a, b) => b[1] - a[1])),
    unclassified_with_cwe: unclassifiedWithCwe,
    // Records counted once per CWE: a record with two unclassified CWEs adds one to each.
    unclassified_top20_cwes: [...unclassifiedCwes].sort((a, b) => b[1] - a[1] || Number(a[0].slice(4)) - Number(b[0].slice(4))).slice(0, 20),
  };
}

const all = [];
const out = { fetched, table: { mapped_cwes: Object.values(CWE_CLASSES).flat().length, decided_unclassified: DECIDED_UNCLASSIFIED.length }, ecosystems: {} };
for (const ecosystem of ["npm", "Packagist"]) {
  const records = [];
  for (const [name, text] of entries(join(dir, `${ecosystem}.zip`))) {
    let record;
    try { record = JSON.parse(text); } catch { throw new Error(`${ecosystem}.zip ${name}: not JSON`); }
    const c = classify(record);
    const id = typeof record.id === "string" ? record.id : "";
    const cweIds = Array.isArray(record.database_specific?.cwe_ids) ? record.database_specific.cwe_ids : [];
    const basis = !id ? null
      : id.startsWith("MAL-") ? "id"
      : Array.isArray(record.aliases) && record.aliases.some(a => typeof a === "string" && a.startsWith("MAL-")) ? "alias"
      : cweIds.some(e => typeof e === "string" && /^CWE-506$/i.test(e.trim())) ? "cwe_506"
      : null;
    if ((basis !== null) !== (c.class === "trap")) throw new Error(`${ecosystem}.zip ${name}: classify() says ${c.class}, the record's fields say ${basis ?? "not trap"}`);
    records.push({ ...c, basis, mal: id.startsWith("MAL-"), withdrawn: typeof record.withdrawn === "string" });
  }
  for (const r of records) all.push(r);
  out.ecosystems[ecosystem] = { all: tally(records), not_mal: tally(records.filter(r => !r.mal)) };
}
out.ecosystems.both = { all: tally(all), not_mal: tally(all.filter(r => !r.mal)) };
console.log(JSON.stringify(out, null, 2));
