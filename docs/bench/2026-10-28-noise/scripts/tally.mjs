// Adds up the reviewers' verdicts (docs/decisions.md, "Noise measurement", sections 4 and 5). It changes no verdict:
// a left-out package with no verdict, or in a repository marked unfinished and not checked, counts as undecidable;
// a miss is production_relevant "yes" or "undecidable". Nothing is fetched.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const noise = JSON.parse(readFileSync("/d/noise.json", "utf8"));
const groups = [[1, 25], [26, 49], [50, 72], [73, 88], [89, 100]];
const out = { groups: [], repositories: [], totals: {}, problems: [] };
const tally = { packages: 0, yes: 0, no: 0, undecidable: 0, missing_verdict: 0, in_range_no: 0 };
groups.forEach(([from, to], gi) => {
  const file = `/r/review-${gi + 1}/verdicts.json`;
  const verdicts = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
  out.groups.push({ group: gi + 1, rows: [from, to], file_present: existsSync(file), repositories_returned: verdicts.length });
  for (let i = from; i <= to; i++) {
    const row = noise.rows[i - 1];
    const v = verdicts.find(x => x.repo === row.repo);
    if (v && v.sha !== row.sha) out.problems.push(`${row.repo}: verdict for sha ${v.sha}, row has ${row.sha}`);
    const byName = new Map((v?.packages ?? []).map(p => [p.name, p]));
    for (const extra of byName.keys()) if (!row.left_out.some(l => l.name === extra)) out.problems.push(`${row.repo}: verdict for ${extra}, which is not left out`);
    const per = { row: i, repo: row.repo, finished: v?.finished ?? false, left_out: row.left_out.length, yes: [], undecidable: [], no: 0 };
    for (const l of row.left_out) {
      tally.packages++;
      const p = byName.get(l.name);
      let verdict = p?.production_relevant;
      if (!p) { tally.missing_verdict++; verdict = "undecidable"; }
      if (!["yes", "no", "undecidable"].includes(verdict)) { out.problems.push(`${row.repo} ${l.name}: verdict ${JSON.stringify(verdict)} read as undecidable`); verdict = "undecidable"; }
      if (verdict === "yes" && p?.in_range !== "yes") out.problems.push(`${row.repo} ${l.name}: production_relevant yes with in_range ${p?.in_range}`);
      if (p?.in_range === "no") tally.in_range_no++;
      tally[verdict]++;
      if (verdict === "yes") per.yes.push({ name: l.name, criterion: p.criterion, evidence: p.evidence });
      else if (verdict === "undecidable") per.undecidable.push({ name: l.name, evidence: p?.evidence ?? "no verdict returned" });
      else per.no++;
    }
    out.repositories.push(per);
  }
});
const missed = out.repositories.filter(r => r.yes.length + r.undecidable.length > 0);
out.totals = { ...tally, misses: tally.yes + tally.undecidable, repositories_with_a_miss: missed.length, repositories: out.repositories.length, miss_gate_met: tally.yes + tally.undecidable === 0 };
writeFileSync("/out/review-tally.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.totals), "problems", out.problems.length);
