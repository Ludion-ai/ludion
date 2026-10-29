// L1d's miss tally (docs/decisions/2026-10-29-l1d-third-sample.md, sections 6 and 7): adds the reviewers' verdicts up,
// per sample, and changes none. A package is a miss when its verdict is "yes" or "undecidable", when its repository is
// not finished and it has no verdict, or when no verdict was returned for it at all. Kept earlier verdicts count the same
// way. Only the third sample's tally decides the miss gate; the others are reference.
// Run in Docker with the bench folder at /b (read-only) and /out: node /s/tally.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const read = p => JSON.parse(readFileSync(p, "utf8"));
const a = read("/b/2026-10-29-l1d/review/assignments.json");
const verdicts = new Map(), unfinished = new Set();
for (const g of a.groups) {
  const file = `/b/2026-10-29-l1d/review/verdicts-${g.group}.json`;
  if (!existsSync(file)) continue;
  for (const r of read(file)) {
    if (r.finished === false) unfinished.add(`${r.repo}`);
    for (const p of r.packages ?? []) verdicts.set(`${r.repo}\0${p.name}`, p);
  }
}
const out = {};
for (const sample of ["third", "original", "second"]) {
  const rows = [];
  for (const g of a.groups) for (const r of g.repositories) if (r.sample === sample) for (const name of r.packages) {
    const v = verdicts.get(`${r.repo}\0${name}`);
    // In an unfinished repository, only a "yes" or a "no" counts as checked; anything else is a miss (the brief).
    const given = v && (!unfinished.has(r.repo) || v.production_relevant === "yes" || v.production_relevant === "no");
    rows.push({ repo: r.repo, name, verdict: given ? v.production_relevant : "no verdict", criterion: v?.criterion ?? null, unfinished: unfinished.has(r.repo) });
  }
  for (const k of a.kept.filter(k => k.sample === sample)) rows.push({ repo: k.repo, name: k.name, verdict: k.production_relevant, criterion: k.criterion, kept_from_earlier: true });
  const miss = rows.filter(x => x.verdict === "yes" || x.verdict === "undecidable" || x.verdict === "no verdict");
  const by = {};
  for (const x of rows) by[x.verdict] = (by[x.verdict] ?? 0) + 1;
  out[sample] = { decides_the_gate: sample === "third", checked: rows.length, by_verdict: by, misses: miss.length, repositories_with_a_miss: new Set(miss.map(x => x.repo)).size, miss_gate_met: miss.length === 0, missed: miss };
}
writeFileSync("/out/review-tally.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { checked: v.checked, by_verdict: v.by_verdict, misses: v.misses, repositories_with_a_miss: v.repositories_with_a_miss }]))));
