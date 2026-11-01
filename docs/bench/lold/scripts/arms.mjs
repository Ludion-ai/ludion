// LOLD: prints the alternative and the diagnostic arms beside the run that gives the answer, and the facts the
// progress record quotes. Writes results-arms.json. Usage (Docker only): node arms.mjs <main results> <alt> <d1> <d2> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [main, alt, d1, d2, outPath] = process.argv.slice(2);
const load = dir => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith(".json")).map(f => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8"))]));
const a = load(main), b = load(alt), c = load(d1), d = load(d2);
const count = (set, outcome) => Object.values(set).filter(r => r.outcome === outcome).length;
const counts = set => ({ built: count(set, "built"), stopped_no_allowed: count(set, "stopped_no_allowed"), failed: count(set, "failed"), no_base: count(set, "no_base"), built_with_a_move: Object.values(set).filter(r => r.outcome === "built" && r.moved_non_v > 0).length });

const rows = Object.keys(a).sort().map(id => ({
  id, package: `${a[id].name} ${a[id].from} -> ${a[id].v}`,
  main: { outcome: a[id].outcome, moved: a[id].moved_non_v ?? null, youngest_at_t: a[id].youngest_age_at_t_hours ?? null },
  alternative: { outcome: b[id]?.outcome, moved: b[id]?.moved_non_v ?? null, youngest_at_t: b[id]?.youngest_age_at_t_hours ?? null, peer_conflict: b[id]?.peer_conflict ?? false, etarget: b[id]?.etarget ?? false, failures: b[id]?.failures?.length ? b[id].failures : (b[id]?.outcome === "failed" ? [String(b[id].reason).slice(0, 300)] : []) },
  no_advisory_filter: { outcome: c[id]?.outcome, moved: c[id]?.moved_non_v ?? null, all_oldest: c[id]?.all_oldest ?? null, youngest_at_t: c[id]?.youngest_age_at_t_hours ?? null, stops: (c[id]?.stops ?? []).map(s => `${s.req} ${JSON.stringify(s.counts)}`), failures: c[id]?.failures ?? (c[id]?.outcome === "failed" ? [String(c[id].reason).slice(0, 300)] : []) },
  no_advisory_no_deprecation_filter: { outcome: d[id]?.outcome, moved: d[id]?.moved_non_v ?? null, all_oldest: d[id]?.all_oldest ?? null, youngest_at_t: d[id]?.youngest_age_at_t_hours ?? null, stops: (d[id]?.stops ?? []).map(s => `${s.req} ${JSON.stringify(s.counts)}`), failures: d[id]?.failures ?? (d[id]?.outcome === "failed" ? [String(d[id].reason).slice(0, 300)] : []), differ_vs_normal_at_t: d[id]?.differing_paths_vs_normal_at_t ?? null, differ_vs_normal: d[id]?.differing_paths_vs_normal ?? null, normal_moved: d[id]?.normal?.versions_moved ?? null, normal_young: d[id]?.normal?.youngest_age?.hours ?? null, normal_at_t_moved: d[id]?.normal_at_t?.versions_moved ?? null, dup: d[id]?.duplicate_names ?? null, peers: d[id]?.new_ls_problems ?? null },
}));

// Why each stopped example stops, in the run that gives the answer.
const stops = Object.values(a).filter(r => r.outcome === "stopped_no_allowed").map(r => ({
  id: r.id, package: `${r.name} ${r.from} -> ${r.v}`, requirements: r.stops.length,
  // A requirement is blocked by the filters alone when something at or before T is in range.
  by: r.stops.map(s => ({ req: s.req, in_range: s.counts?.in_range, after_t: s.counts?.after_t, advisory: s.counts?.advisory, deprecated: s.counts?.deprecated, withdrawn: s.counts?.withdrawn })),
}));

// Non-V versions younger than each wait at T, in the built examples.
const young = [];
for (const r of Object.values(a)) for (const i of r.items ?? []) if (i.age_at_t_hours !== null && i.age_at_t_hours < 72) young.push({ id: r.id, version: `${i.name}@${i.to}`, published: i.published, v_published: r.v_published, age_at_t_hours: i.age_at_t_hours, minutes_from_v: Math.round((Date.parse(i.published) - Date.parse(r.v_published)) / 6e4), ranges: i.ranges });

const output = { main: counts(a), alternative: counts(b), no_advisory_filter: counts(c), no_advisory_no_deprecation_filter: counts(d), young_at_t: young, stops, rows };
writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ main: output.main, alternative: output.alternative, no_advisory_filter: output.no_advisory_filter, no_advisory_no_deprecation_filter: output.no_advisory_no_deprecation_filter }));
for (const r of rows) console.log(r.id, r.package, "| main", r.main.outcome, r.main.moved, "| alt", r.alternative.outcome, r.alternative.moved, r.alternative.youngest_at_t, r.alternative.etarget ? "ETARGET" : "", r.alternative.peer_conflict ? "ERESOLVE" : "", r.alternative.failures.join(" ~ ").slice(0, 170), "| d1", r.no_advisory_filter.outcome, r.no_advisory_filter.moved, r.no_advisory_filter.stops.join(" ; ").slice(0, 110), "| d2", r.no_advisory_no_deprecation_filter.outcome, r.no_advisory_no_deprecation_filter.moved, r.no_advisory_no_deprecation_filter.all_oldest, "normal", r.no_advisory_no_deprecation_filter.normal_moved, "young", r.no_advisory_no_deprecation_filter.normal_young, r.no_advisory_no_deprecation_filter.stops.join(" ; ").slice(0, 110), r.no_advisory_no_deprecation_filter.failures.join(" ~ ").slice(0, 170));
console.log("young", JSON.stringify(young));
