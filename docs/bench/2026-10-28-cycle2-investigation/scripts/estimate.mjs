// Per source: how many of backtest v4's unknown versions have every unreadable key covered by that source.
// An upper bound on what the source could clear: newly readable versions can have unreadable dependencies of their own.
import { readFileSync, writeFileSync } from "node:fs";
const d = JSON.parse(readFileSync("/d/diag-unknown.json", "utf8"));
const p = JSON.parse(readFileSync("/d/probe.json", "utf8"));
const kind = d.keys;
const eco = new Set(), jsd = new Set(), dd = new Set();
for (const r of p.removed) {
  if (r.ecosystems.status === 200 && r.ecosystems.metadata && r.ecosystems.runtime_deps !== null) eco.add(r.key);
  if (r.jsdelivr.status === 200 && typeof r.jsdelivr.deps === "number") jsd.add(r.key);
  if (r.depsdev.status === 200) dd.add(r.key);
}
// The three unverified same-release checks need the candidate's publisher and provenance: ecosyste.ms has both.
for (const [k, v] of Object.entries(kind)) if (v === "same-release check unverified" && p.extra[k.split(":")[0]]?.publisher) eco.add(k);
const sources = { "deps.dev": dd, "ecosyste.ms": eco, jsDelivr: jsd, "ecosyste.ms + jsDelivr": new Set([...eco, ...jsd]) };
const out = { keys: { total: Object.keys(kind).length, by_kind: d.by_kind, covered: Object.fromEntries(Object.entries(sources).map(([s, set]) => [s, set.size])) }, per_urgency: {} };
for (const [u, v] of Object.entries(d.per_urgency)) {
  const row = { unknown: v.versions, with_unparseable_spec: 0, with_package_not_served: 0, only_removed_or_unverified: 0, cleared_upper_bound: {} };
  for (const r of v.rows) {
    if (r.keys.some(k => kind[k] === "unparseable spec")) row.with_unparseable_spec++;
    if (r.keys.some(k => kind[k] === "package not served")) row.with_package_not_served++;
    if (r.keys.every(k => kind[k] === "version removed (time kept)" || kind[k] === "same-release check unverified")) row.only_removed_or_unverified++;
  }
  for (const [s, set] of Object.entries(sources)) row.cleared_upper_bound[s] = v.rows.filter(r => r.keys.every(k => set.has(k))).length;
  out.per_urgency[u] = row;
}
writeFileSync("/d/estimate.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
