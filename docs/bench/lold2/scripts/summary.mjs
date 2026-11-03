// LOLD2: the counts from run.mjs's results, beside LOLD's. Usage: node summary.mjs <results dir> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
const rows = readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(join(dir, f), "utf8"))).sort((a, b) => a.id.localeCompare(b.id));
const count = what => rows.filter(what).length;
const built = rows.filter(r => r.outcome === "built");
const summary = {
  examples: rows.length,
  counted: count(r => ["built", "stopped_no_allowed", "not_in_table", "failed"].includes(r.outcome)),
  built: built.length,
  built_with_a_move: count(r => r.outcome === "built" && r.moved_non_v > 0),
  built_with_a_path_that_moved: count(r => r.outcome === "built" && r.path_moved > 0),
  stopped_no_allowed: count(r => r.outcome === "stopped_no_allowed"),
  not_in_table: count(r => r.outcome === "not_in_table"),
  failed: count(r => r.outcome === "failed"),
  no_base: count(r => r.outcome === "no_base"),
  same_outcome_as_lold: count(r => r.outcome === r.lold_outcome),
  moved_versions: built.reduce((sum, r) => sum + r.moved_non_v, 0),
  judge_on_built: Object.fromEntries(["ready_except_build", "stop", "wait", "undecidable"].map(v => [v, built.filter(r => r.judge === v).length])),
  unneeded_moves: built.reduce((sum, r) => sum + r.unneeded_moves.length, 0),
  new_unmet: built.reduce((sum, r) => sum + r.new_unmet.length, 0),
  assert_problems: built.reduce((sum, r) => sum + r.assert.problems.length, 0),
  npm_ci_dry_run_not_zero: built.filter(r => r.npm_ci_dry_run !== 0).map(r => r.id),
  npm_ls_problems: built.filter(r => r.npm_ls_problems !== 0).map(r => [r.id, r.npm_ls_problems]),
  lock_changed_by_npm_install: built.filter(r => !r.lock_unchanged || r.npm_install_again !== 0).map(r => r.id),
  rows: rows.map(r => ({ id: r.id, package: r.package, lold: r.lold_outcome, outcome: r.outcome, moved: r.moved_non_v ?? null, path_moved: r.path_moved ?? null, path_added: r.path_added ?? null, path_removed: r.path_removed ?? null, requirements: r.table_requirements ?? null, table_seconds: r.table_seconds ?? null, judge: r.judge ?? null, refusal: r.refusal ?? null, no_answer: r.no_answer ?? null, youngest: r.assert?.youngest ?? null, wait_hours: r.assert?.wait_hours ?? null, failure: r.failure ?? null })),
};
writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
const { rows: _rows, ...head } = summary;
console.log(JSON.stringify(head, null, 1));
