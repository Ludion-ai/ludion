// LOLD: prints the progress record's tables from the raw results. Usage (Docker only): node tables.mjs <main results> <alt> <d1> <d2>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [main, alt, d1, d2] = process.argv.slice(2);
const load = dir => Object.fromEntries(readdirSync(dir).filter(f => f.endsWith(".json") && f !== "summary.json").map(f => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8"))]));
const a = load(main), b = load(alt), c = load(d1), d = load(d2);
const show = v => (v === null || v === undefined ? "-" : v);
const youngest = r => r?.youngest_age?.hours;

console.log("### main");
console.log("| Id | Fix | Outcome | Moved (non-V) | All oldest | Youngest at T (h) | Normal: moved / differ / youngest (h) / after T | Normal at T: moved / differ / youngest (h) | Copies of a name, base / oldest / normal |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const id of Object.keys(a).sort()) {
  const r = a[id];
  console.log(`| ${id} | ${r.name} ${r.from} -> ${r.v} | ${r.outcome} | ${show(r.moved_non_v)} | ${r.all_oldest === undefined ? "-" : r.all_oldest ? "yes" : "no"} | ${show(r.youngest_age_at_t_hours)} | ${show(r.normal?.versions_moved)} / ${show(r.differing_paths_vs_normal)} / ${show(youngest(r.normal))} / ${show(r.normal?.published_after_t)} | ${show(r.normal_at_t?.versions_moved)} / ${show(r.differing_paths_vs_normal_at_t)} / ${show(youngest(r.normal_at_t))} | ${show(r.base?.duplicate_names)} / ${show(r.duplicate_names)} / ${show(r.normal?.duplicate_names)} |`);
}

console.log("\n### stops");
console.log("| Id | Requirements with nothing left | Of them, with something at or before T and in range |");
console.log("|---|---|---|");
for (const id of Object.keys(a).sort()) {
  const r = a[id];
  if (r.outcome !== "stopped_no_allowed") continue;
  const sized = r.stops.filter(s => s.counts && s.counts.in_range - s.counts.after_t > 0);
  console.log(`| ${id} | ${r.stops.length} | ${sized.length}; e.g. ${r.stops[0].req}: ${JSON.stringify(r.stops[0].counts)} |`);
}

console.log("\n### arms");
console.log("| Id | Fix | Rule | Without the advisory filter | Without advisory and deprecation filters: moved, oldest / normal moved / differ, youngest at T (h), scripts, engines | Alternative: outcome, moved, youngest at T (h) |");
console.log("|---|---|---|---|---|---|");
for (const id of Object.keys(a).sort()) {
  const r = a[id], x = c[id], y = d[id], z = b[id];
  const reason = z.outcome === "failed" ? (z.etarget ? "failed (ETARGET)" : z.peer_conflict ? "failed (ERESOLVE)" : "failed") : z.outcome;
  console.log(`| ${id} | ${r.name} | ${r.outcome} | ${x.outcome} | ${y.outcome}${y.outcome === "built" ? `: ${y.moved_non_v}, ${y.all_oldest ? "yes" : "no"} / ${show(y.normal?.versions_moved)} / ${show(y.differing_paths_vs_normal)}, ${show(y.youngest_age_at_t_hours)}, ${y.install_scripts?.length ?? "-"}, ${y.engines_not_node24?.length ?? "-"}` : ""} | ${reason}, ${show(z.moved_non_v)}, ${show(z.youngest_age_at_t_hours)} |`);
}

const set = (s, f) => Object.values(s).filter(f);
const stats = (label, s) => {
  const built = set(s, r => r.outcome === "built");
  const moving = built.filter(r => r.moved_non_v > 0);
  const young = moving.filter(r => (r.items ?? []).some(i => i.age_at_t_hours !== null && i.age_at_t_hours < 72));
  console.log(label, JSON.stringify({
    built: built.length, moving: moving.length, versions: moving.reduce((n, r) => n + r.moved_non_v, 0),
    not_oldest: built.reduce((n, r) => n + (r.items ?? []).filter(i => !i.oldest).length, 0),
    reused_base: built.reduce((n, r) => n + (r.items ?? []).filter(i => i.reused_base).length, 0),
    examples_with_a_version_under_72h_at_t: young.map(r => r.id),
    versions_under_72h_at_t: moving.flatMap(r => (r.items ?? []).filter(i => i.age_at_t_hours !== null && i.age_at_t_hours < 72)).length,
    furthest_from_v_minutes: Math.max(0, ...moving.flatMap(r => (r.items ?? []).filter(i => i.age_at_t_hours !== null && i.age_at_t_hours < 72).map(i => Math.abs(Date.parse(i.published) - Date.parse(r.v_published)) / 6e4))),
    new_ls_problems: built.reduce((n, r) => n + (r.new_ls_problems ?? 0), 0),
    peer_conflicts: set(s, r => r.peer_conflict).length,
    new_duplicate_names: built.reduce((n, r) => n + (r.duplicates_new_vs_base?.length ?? 0), 0),
    examples_with_new_duplicates: built.filter(r => r.duplicates_new_vs_base?.length).map(r => r.id),
    install_scripts: built.flatMap(r => r.install_scripts ?? []),
    engines_not_node24: built.flatMap(r => r.engines_not_node24 ?? []),
    examples_where_checks_fail_on_normal_at_t: built.filter(r => r.checks_on_normal_at_t_fail > 0).map(r => `${r.id}:${r.checks_on_normal_at_t_fail}`),
    differ_vs_normal: moving.filter(r => r.differing_paths_vs_normal > 0).length,
    differ_vs_normal_at_t: moving.filter(r => r.differing_paths_vs_normal_at_t > 0).length,
    probe_stops: built.filter(r => r.probe_stops?.length).map(r => r.id),
    normal_after_t_total: moving.reduce((n, r) => n + (r.normal?.published_after_t ?? 0), 0),
    excluded: built.reduce((sum, r) => { for (const k of Object.keys(sum)) sum[k] += r.excluded_totals?.[k] ?? 0; return sum; }, { after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0, no_time: 0 }),
  }));
};
console.log("\n### stats");
stats("main", a); stats("d1", c); stats("d2", d);
const normalAges = set(a, r => r.normal?.youngest_age).map(r => r.normal.youngest_age.hours);
console.log("normal youngest (all examples):", JSON.stringify({ n: normalAges.length, min: Math.min(...normalAges) }));
const moved = (s, r) => s[r.id].moved_non_v;
console.log("oldest vs normal moved, d2:", set(d, r => r.outcome === "built").map(r => `${r.id} ${r.moved_non_v}/${r.normal?.versions_moved}/${r.normal_at_t?.versions_moved}`).join(" "), moved.length ? "" : "");
for (const id of Object.keys(b).sort()) if (b[id].outcome === "failed") console.log("alt failed", id, String(b[id].reason).split("\n").filter(l => /notarget No matching|ERESOLVE|ETARGET/.test(l)).slice(0, 2).join(" | ").slice(0, 220));
