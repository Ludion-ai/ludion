// Adds up the rerun's verdicts (docs/decisions.md, "Gate 1's production/dev split, rebuilt", sections 5 and 6): the
// first-run "yes" verdicts reused by section 5 (assignments.json) and the reviewers' verdicts (review/verdicts-N.json).
// It changes no verdict: a left-out package with no verdict, or unchecked in a repository marked unfinished, counts as
// undecidable; a miss is production_relevant "yes" or "undecidable". Nothing is fetched. Run in Docker, /b read-only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const rerun = JSON.parse(readFileSync("/b/result/noise.json", "utf8"));
const assignments = JSON.parse(readFileSync("/b/review/assignments.json", "utf8"));
const reviewed = new Map(), problems = [], files = [];
for (const g of assignments.groups) {
  const file = `/b/review/verdicts-${g.group}.json`;
  files.push({ group: g.group, rows: g.rows, items: g.items, file_present: existsSync(file) });
  if (!existsSync(file)) continue;
  const assigned = new Map(g.repositories.map(r => [r.repo, new Set(r.items.map(x => x.name))]));
  for (const r of JSON.parse(readFileSync(file, "utf8"))) {
    if (!assigned.has(r.repo)) { problems.push(`group ${g.group}: verdicts for ${r.repo}, which is not assigned to it`); continue; }
    const row = rerun.rows.find(x => x.repo === r.repo);
    if (r.sha !== row.sha) problems.push(`${r.repo}: verdict for sha ${r.sha}, row has ${row.sha}`);
    for (const p of r.packages) {
      if (!assigned.get(r.repo).has(p.name)) { problems.push(`${r.repo} ${p.name}: a verdict for a package not assigned`); continue; }
      if (reviewed.has(`${r.repo}\0${p.name}`)) problems.push(`${r.repo} ${p.name}: two verdicts`);
      reviewed.set(`${r.repo}\0${p.name}`, { ...p, group: g.group, finished: r.finished });
    }
  }
}
const reusedYes = new Map(assignments.reused_yes.map(v => [`${v.repo}\0${v.name}`, v]));
const firstRun = new Map(assignments.groups.flatMap(g => g.repositories.flatMap(r => r.items.map(x => [`${r.repo}\0${x.name}`, x.first_run]))));
const tally = { packages: 0, yes: 0, no: 0, undecidable: 0, missing_verdict: 0, in_range_no: 0, reused_yes: 0, reused_no: 0 };
const byFirstRun = {}, byCriterion = {}, repositories = [];
for (const row of rerun.rows) {
  const per = { repo: row.repo, left_out: row.left_out.length, yes: [], undecidable: [], no: 0 };
  for (const l of row.left_out) {
    tally.packages++;
    const key = `${row.repo}\0${l.name}`, reuse = reusedYes.get(key), v = reuse ?? reviewed.get(key);
    let verdict = v?.production_relevant;
    if (!v) { tally.missing_verdict++; verdict = "undecidable"; }
    if (!["yes", "no", "undecidable"].includes(verdict)) { problems.push(`${row.repo} ${l.name}: verdict ${JSON.stringify(verdict)} read as undecidable`); verdict = "undecidable"; }
    if (verdict === "yes" && v?.in_range !== "yes") problems.push(`${row.repo} ${l.name}: production_relevant yes with in_range ${v?.in_range}`);
    if (!reuse && v && v.reused === true && (v.first_run !== "no" || verdict !== "no")) problems.push(`${row.repo} ${l.name}: reused ${v.first_run} as ${verdict}`);
    if (v?.in_range === "no") tally.in_range_no++;
    if (reuse) tally.reused_yes++;
    if (!reuse && v?.reused === true) tally.reused_no++;
    tally[verdict]++;
    const first = reuse ? "yes" : firstRun.get(key) ?? "unknown";
    byFirstRun[first] ??= { yes: 0, no: 0, undecidable: 0 };
    byFirstRun[first][verdict]++;
    if (verdict === "yes") byCriterion[v.criterion ?? "none"] = (byCriterion[v.criterion ?? "none"] ?? 0) + 1;
    if (verdict === "yes") per.yes.push({ name: l.name, first_run: first, criterion: v.criterion, evidence: v.evidence });
    else if (verdict === "undecidable") per.undecidable.push({ name: l.name, first_run: first, evidence: v?.evidence ?? "no verdict returned" });
    else per.no++;
  }
  repositories.push(per);
}
const missed = repositories.filter(r => r.yes.length + r.undecidable.length > 0);
const totals = { ...tally, misses: tally.yes + tally.undecidable, repositories_with_a_miss: missed.length, repositories: repositories.length, miss_gate_met: tally.yes + tally.undecidable === 0 };
writeFileSync("/out/review-tally.json", JSON.stringify({ files, totals, by_first_run: byFirstRun, yes_by_criterion: byCriterion, problems, repositories }, null, 1));
console.log(JSON.stringify(totals), "by first run", JSON.stringify(byFirstRun), "problems", problems.length);
