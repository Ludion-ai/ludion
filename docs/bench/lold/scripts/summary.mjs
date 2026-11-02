// LOLD: tabulates results/<id>.json and applies ../definitions.md, section 8. Writes nothing but stdout and the given file.
// Usage (Docker only): node summary.mjs <results dir> <summary.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, outPath] = process.argv.slice(2);
const results = readdirSync(dir).filter(f => f.endsWith(".json") && f !== "summary.json").sort().map(f => JSON.parse(readFileSync(join(dir, f), "utf8")));
const by = outcome => results.filter(r => r.outcome === outcome);
const counted = results.filter(r => r.outcome !== "no_base");
const built = by("built"), stopped = by("stopped_no_allowed"), failed = by("failed");
const builtMoving = built.filter(r => r.moved_non_v > 0);

let answer;
if (!failed.length && stopped.length <= 0.1 * counted.length && builtMoving.length >= 5) answer = "built";
else if (built.length < counted.length / 2) answer = "cannot_be_built";
else answer = "partial";

const rows = results.map(r => ({
  id: r.id, package: `${r.name} ${r.from} -> ${r.v}`, outcome: r.outcome, t: r.t ?? null,
  base_entries: r.base?.entries ?? null,
  moved_non_v: r.moved_non_v ?? null,
  all_oldest: r.all_oldest ?? null,
  reused_base: r.items?.filter(i => i.reused_base).length ?? null,
  youngest_age_at_t_hours: r.youngest_age_at_t_hours ?? null,
  normal_moved: r.normal?.versions_moved ?? null,
  differ_vs_normal: r.differing_paths_vs_normal ?? null,
  normal_youngest_age_hours: r.normal?.youngest_age?.hours ?? null,
  normal_after_t: r.normal?.published_after_t ?? null,
  normal_at_t_moved: r.normal_at_t?.versions_moved ?? null,
  differ_vs_normal_at_t: r.differing_paths_vs_normal_at_t ?? null,
  normal_at_t_youngest_age_hours: r.normal_at_t?.youngest_age?.hours ?? null,
  checks_on_normal_at_t_fail: r.checks_on_normal_at_t_fail ?? null,
  duplicates_base: r.base?.duplicate_names ?? null, duplicates_oldest: r.duplicate_names ?? null, duplicates_normal: r.normal?.duplicate_names ?? null, duplicates_normal_at_t: r.normal_at_t?.duplicate_names ?? null,
  new_ls_problems: r.new_ls_problems ?? null, normal_ls_problems: r.normal?.ls_problems ?? null, normal_at_t_ls_problems: r.normal_at_t?.ls_problems ?? null,
  peer_conflict: r.peer_conflict ?? false,
  install_scripts: r.install_scripts?.length ?? null, engines_not_node24: r.engines_not_node24?.length ?? null,
  excluded: r.excluded_totals ?? null,
  stops: r.stops?.length ? r.stops : null,
  failures: r.failures?.length ? r.failures : (r.outcome === "failed" ? [String(r.reason).slice(0, 400)] : null),
}));

const summary = {
  answer,
  counts: { examples: results.length, counted: counted.length, built: built.length, built_with_a_move: builtMoving.length, stopped_no_allowed: stopped.length, failed: failed.length, no_base: by("no_base").length },
  rows,
};
writeFileSync(outPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary.counts), summary.answer);
for (const r of rows) console.log([r.id, r.package, r.outcome, `moved=${r.moved_non_v}`, `oldest=${r.all_oldest}`, `reused=${r.reused_base}`, `youngT=${r.youngest_age_at_t_hours}`, `| normal moved=${r.normal_moved} differ=${r.differ_vs_normal} young=${r.normal_youngest_age_hours} afterT=${r.normal_after_t}`, `| atT moved=${r.normal_at_t_moved} differ=${r.differ_vs_normal_at_t} young=${r.normal_at_t_youngest_age_hours} chk=${r.checks_on_normal_at_t_fail}`, `| dup ${r.duplicates_base}/${r.duplicates_oldest}/${r.duplicates_normal}/${r.duplicates_normal_at_t}`, `ls+=${r.new_ls_problems}`, `peer=${r.peer_conflict}`, `script=${r.install_scripts}`, `eng=${r.engines_not_node24}`].join(" "));
