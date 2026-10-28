// L1c's review assignments (docs/decisions/2026-10-29-l1c-new-sample.md, section 5). The new sample: every left-out
// package is reviewed. The original 100: a package left out now and by the rerun in the same repository keeps the
// rerun's verdict (docs/bench/2026-10-28-noise-v2/review); every other left-out package is reviewed. Groups are runs of
// whole repositories in sample order. It changes no verdict and fetches nothing.
// Run in Docker with the bench folder at /b (read-only) and /out: node /s/assign.mjs <groups>
import { readFileSync, writeFileSync } from "node:fs";

const GROUPS = Number(process.argv[2] ?? 6);
const read = p => JSON.parse(readFileSync(p, "utf8"));
const rerun = read("/b/2026-10-28-noise-v2/result/noise.json");
const rerunVerdicts = new Map();
for (let g = 1; g <= 5; g++) for (const r of read(`/b/2026-10-28-noise-v2/review/verdicts-${g}.json`)) for (const p of r.packages) rerunVerdicts.set(`${r.repo}\0${p.name}`, { ...p, sha: r.sha, finished: r.finished });
const rerunLeftOut = new Set(rerun.rows.flatMap(r => r.left_out.map(l => `${r.repo}\0${l.name}`)));

const items = [], reused = [];
for (const [sample, file] of [["new", "/b/2026-10-29-l1c/result-new/noise.json"], ["original", "/b/2026-10-29-l1c/result-original/noise.json"]]) {
  for (const [i, row] of read(file).rows.entries()) {
    const review = [];
    for (const l of row.left_out) {
      const key = `${row.repo}\0${l.name}`, v = rerunVerdicts.get(key);
      if (sample === "original" && rerunLeftOut.has(key) && v && v.sha === row.sha) reused.push({ repo: row.repo, sha: row.sha, name: l.name, in_range: v.in_range, production_relevant: v.production_relevant, criterion: v.criterion, evidence: `Kept from the rerun's review (section 5): ${v.evidence}` });
      else review.push(l.name);
    }
    if (review.length) items.push({ sample, row: i + 1, repo: row.repo, sha: row.sha, packages: review });
  }
}
const total = items.reduce((s, r) => s + r.packages.length, 0), target = Math.ceil(total / GROUPS);
const groups = [];
let current = [];
for (const r of items) {
  current.push(r);
  if (current.reduce((s, x) => s + x.packages.length, 0) >= target && groups.length < GROUPS - 1) { groups.push(current); current = []; }
}
if (current.length) groups.push(current);
const counts = { to_review: total, to_review_new: items.filter(r => r.sample === "new").reduce((s, r) => s + r.packages.length, 0), to_review_original: items.filter(r => r.sample === "original").reduce((s, r) => s + r.packages.length, 0), kept_from_rerun: reused.length };
writeFileSync("/out/assignments.json", JSON.stringify({ counts, kept_from_rerun: reused, groups: groups.map((g, i) => ({ group: i + 1, items: g.reduce((s, r) => s + r.packages.length, 0), repositories: g })) }, null, 1));
console.log(JSON.stringify(counts), groups.map((g, i) => `group ${i + 1}: ${g.length} repositories, ${g.reduce((s, r) => s + r.packages.length, 0)} items`).join("; "));
