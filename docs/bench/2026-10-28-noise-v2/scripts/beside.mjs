// The second execution, reported beside the result (docs/decisions.md, "#168's review: the split's reader is fixed to
// section 2, and a second execution is reported beside the result"). Its misses come from the review's verdicts for the
// packages it still leaves out; a left-out package the review did not check counts as undecidable. It also checks that
// its left-out list is a subset of the result's. It changes no verdict and fetches nothing. Run in Docker, /b read-only.
import { readFileSync, writeFileSync } from "node:fs";

const result = JSON.parse(readFileSync("/b/result/noise.json", "utf8"));
const fixed = JSON.parse(readFileSync("/b/result-fixed/noise.json", "utf8"));
const verdicts = new Map();
for (let g = 1; g <= 5; g++) for (const r of JSON.parse(readFileSync(`/b/review/verdicts-${g}.json`, "utf8"))) for (const p of r.packages) verdicts.set(`${r.repo}\0${p.name}`, { ...p, sha: r.sha });
const before = new Set(result.rows.flatMap(r => r.left_out.map(l => `${r.repo}\0${l.name}`)));
const out = { result: { npm_audit: result.totals.npm_audit, judge_production: result.totals.judge_production, left_out: result.totals.left_out }, fixed: { ...fixed.totals, count_gate: fixed.count_gate, splits: fixed.also_shown.splits, failed: fixed.failed.length }, not_in_result: [], unreviewed: [], misses: [], no_longer_left_out: [] };
const still = new Set();
for (const row of fixed.rows) for (const l of row.left_out) {
  const key = `${row.repo}\0${l.name}`, v = verdicts.get(key);
  still.add(key);
  if (!before.has(key)) out.not_in_result.push({ repo: row.repo, name: l.name });
  const verdict = v && v.sha === row.sha ? v.production_relevant : "undecidable";
  if (!v) out.unreviewed.push({ repo: row.repo, name: l.name });
  if (verdict !== "no") out.misses.push({ repo: row.repo, name: l.name, verdict, criterion: v?.criterion ?? null });
}
for (const key of before) if (!still.has(key)) { const [repo, name] = key.split("\0"); out.no_longer_left_out.push({ repo, name, verdict: verdicts.get(key)?.production_relevant ?? "none" }); }
out.totals = { left_out: still.size, misses: out.misses.length, repositories_with_a_miss: new Set(out.misses.map(m => m.repo)).size, miss_gate_met: out.misses.length === 0, subset_of_result: out.not_in_result.length === 0, unreviewed: out.unreviewed.length, no_longer_left_out: out.no_longer_left_out.length };
writeFileSync("/out/beside-tally.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.totals), JSON.stringify(out.fixed));
