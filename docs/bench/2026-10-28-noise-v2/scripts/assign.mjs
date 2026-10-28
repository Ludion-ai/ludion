// Splits the rerun's left-out packages for the review (docs/decisions.md, "Gate 1's production/dev split, rebuilt",
// section 5). A first-run "yes" for the same repository and package is reused as "yes"; a first-run "no" goes to a
// reviewer to decide whether it stands; a first-run "undecidable" and a newly left-out package are reviewed again.
// It changes no verdict and fetches nothing. Run in Docker with the bench folder at /b (read-only) and /out.
import { readFileSync, writeFileSync } from "node:fs";

const GROUPS = Number(process.argv[2] ?? 5);
const rerun = JSON.parse(readFileSync("/b/2026-10-28-noise-v2/result/noise.json", "utf8"));
const firstVerdicts = new Map();
for (let g = 1; g <= 5; g++) for (const r of JSON.parse(readFileSync(`/b/2026-10-28-noise/review/verdicts-${g}.json`, "utf8"))) {
  for (const p of r.packages) firstVerdicts.set(`${r.repo}\0${p.name}`, { ...p, sha: r.sha, finished: r.finished });
}
const firstLeftOut = new Set(JSON.parse(readFileSync("/b/2026-10-28-noise/noise.json", "utf8")).rows.flatMap(r => r.left_out.map(l => `${r.repo}\0${l.name}`)));
const rows = rerun.rows.map((row, i) => {
  const items = row.left_out.map(l => {
    const key = `${row.repo}\0${l.name}`, v = firstLeftOut.has(key) ? firstVerdicts.get(key) : undefined;
    const first = !firstLeftOut.has(key) ? "none" : !v || v.sha !== row.sha ? "undecidable" : v.production_relevant;
    return { name: l.name, first_run: first, first_evidence: v?.evidence ?? null, first_criterion: v?.criterion ?? null, first_in_range: v?.in_range ?? null };
  });
  return { row: i + 1, repo: row.repo, sha: row.sha, items };
});
const reused = rows.flatMap(r => r.items.filter(x => x.first_run === "yes").map(x => ({ repo: r.repo, sha: r.sha, name: x.name, in_range: x.first_in_range, production_relevant: "yes", criterion: x.first_criterion, evidence: `Reused from the first run (section 5): ${x.first_evidence}` })));
const toReview = rows.map(r => ({ ...r, items: r.items.filter(x => x.first_run !== "yes") })).filter(r => r.items.length);
const total = toReview.reduce((s, r) => s + r.items.length, 0), target = Math.ceil(total / GROUPS);
const groups = [];
let current = [];
for (const r of toReview) {
  current.push(r);
  if (current.reduce((s, x) => s + x.items.length, 0) >= target && groups.length < GROUPS - 1) { groups.push(current); current = []; }
}
if (current.length) groups.push(current);
const counts = { left_out: rows.reduce((s, r) => s + r.items.length, 0), reused_yes: reused.length, to_review: total, by_first_run: {} };
for (const r of rows) for (const x of r.items) counts.by_first_run[x.first_run] = (counts.by_first_run[x.first_run] ?? 0) + 1;
writeFileSync("/out/assignments.json", JSON.stringify({ counts, reused_yes: reused, groups: groups.map((g, i) => ({ group: i + 1, rows: [g[0].row, g.at(-1).row], items: g.reduce((s, r) => s + r.items.length, 0), repositories: g })) }, null, 1));
console.log(JSON.stringify(counts), groups.map((g, i) => `group ${i + 1}: rows ${g[0].row}-${g.at(-1).row}, ${g.reduce((s, r) => s + r.items.length, 0)} items`).join("; "));
