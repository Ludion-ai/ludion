// L1d's review assignments (docs/decisions/2026-10-29-l1d-third-sample.md, sections 6 and 7). The third sample: every
// left-out package is reviewed. The reference samples: a package left out now that has an earlier verdict in the same
// repository at the same SHA keeps it (L1c's verdicts for the second 100; the noise rerun's and L1c's for the original
// 100), because the split only adds production since then; every other left-out package is reviewed. Groups are runs of
// whole repositories in sample order. It changes no verdict and fetches nothing.
// Run in Docker with the bench folder at /b (read-only) and /out: node /s/assign.mjs <groups>
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const GROUPS = Number(process.argv[2] ?? 6);
const read = p => JSON.parse(readFileSync(p, "utf8"));
const verdictsIn = dir => readdirSync(dir).filter(f => /^verdicts-\d+\.json$/.test(f)).flatMap(f => read(`${dir}/${f}`));
const earlier = new Map();
const keep = (repo, sha, p, from) => { const key = `${repo}\0${sha}\0${p.name}`; if (!earlier.has(key)) earlier.set(key, { ...p, from }); };
// L1c reviewed the second 100 in full and 3 packages of the original 100; the rest of the original 100 kept the rerun's.
for (const r of verdictsIn("/b/2026-10-29-l1c/review")) for (const p of r.packages) keep(r.repo, r.sha, p, "docs/bench/2026-10-29-l1c/review");
for (const r of verdictsIn("/b/2026-10-28-noise-v2/review")) for (const p of r.packages) keep(r.repo, r.sha, p, "docs/bench/2026-10-28-noise-v2/review");

const items = [], kept = [];
for (const sample of ["third", "original", "second"]) {
  const file = `/b/2026-10-29-l1d/result-${sample}/noise.json`;
  if (!existsSync(file)) continue;
  for (const [i, row] of read(file).rows.entries()) {
    const review = [];
    for (const l of row.left_out) {
      const v = sample === "third" ? undefined : earlier.get(`${row.repo}\0${row.sha}\0${l.name}`);
      if (v) kept.push({ sample, repo: row.repo, sha: row.sha, name: l.name, in_range: v.in_range, production_relevant: v.production_relevant, criterion: v.criterion, evidence: `Kept from ${v.from} (section 7): ${v.evidence}` });
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
const by = s => items.filter(r => r.sample === s).reduce((n, r) => n + r.packages.length, 0);
const counts = { to_review: total, to_review_third: by("third"), to_review_original: by("original"), to_review_second: by("second"), kept_from_earlier: kept.length };
writeFileSync("/out/assignments.json", JSON.stringify({ counts, kept, groups: groups.map((g, i) => ({ group: i + 1, items: g.reduce((s, r) => s + r.packages.length, 0), repositories: g })) }, null, 1));
console.log(JSON.stringify(counts), groups.map((g, i) => `group ${i + 1}: ${g.length} repositories, ${g.reduce((s, r) => s + r.packages.length, 0)} items`).join("; "));
