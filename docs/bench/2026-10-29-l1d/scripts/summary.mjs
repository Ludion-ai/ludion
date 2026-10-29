// L1d: the numbers the README reports, read from the three measurements' outputs and the sources volumes (read-only),
// so that every figure is copied from data, not typed. Nothing is fetched or run.
// Usage, in Docker: node summary.mjs <bench dir> with /src3, /src1m and /src2m mounted read-only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const bench = process.argv[2];
const out = {};
for (const [sample, vol] of [["third", "/src3"], ["original", "/src1m"], ["second", "/src2m"]]) {
  const dir = join(bench, `2026-10-29-l1d/result-${sample}`);
  const n = JSON.parse(readFileSync(join(dir, "noise.json"), "utf8"));
  const log = JSON.parse(readFileSync(join(dir, "sources-log.json"), "utf8")).repositories;
  const measured = new Set(n.rows.map(r => r.repo));
  const sources = log.filter(s => measured.has(s.repo));
  const gitmodules = n.rows.filter(r => existsSync(join(vol, r.repo.replace("/", "__"), ".gitmodules"))).map(r => r.repo);
  out[sample] = {
    repositories: n.repositories, failed: n.failed.length, totals: n.totals, count_gate: n.count_gate,
    needed_at_most: Math.floor(n.totals.npm_audit / 3), also_shown: n.also_shown,
    ...(n.exclusions_by_cause ? { candidates: n.candidates, considered: n.considered, exclusions_by_cause: n.exclusions_by_cause } : {}),
    sources: { fetched: sources.filter(s => s.ok).length, not_fetched: sources.filter(s => !s.ok).map(s => s.repo), retried: sources.filter(s => s.attempt > 1).map(s => s.repo), export_ignore: sources.filter(s => s.export_ignore?.length).map(s => s.repo) },
    incomplete: n.rows.filter(r => r.split.source === "incomplete").map(r => `${r.repo}: ${r.split.incomplete}`),
    image_holds_dev: n.rows.filter(r => r.split.images_with_dev.length).map(r => r.repo),
    gitmodules,
  };
}
console.log(JSON.stringify(out, null, 1));
