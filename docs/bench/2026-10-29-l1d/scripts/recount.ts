// L1d: the split at a given production.ts, recomputed over a measured sample's own OSV results (the vulnerable versions
// its noise.json lists), with package.json and package-lock.json from raw.githubusercontent.com at each row's SHA and
// the source tree as sources.ts fetched it. Shown beside measurements, never instead of one: it separates what the
// split changes from what the advisory databases change, and says for each of the 69 misses
// (docs/bench/2026-10-29-l1d/classification.json) whether the split now counts it. No project code runs; OSV is not queried.
//
// Usage, in Docker only (read-only root, non-root, no forwarded environment; network for raw.githubusercontent.com):
//   node recount.ts <split root> <noise.json> <sources dir> <out file> [<classification.json> <sample label>]
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sourceOf } from "./sources.ts";

const [root, noiseFile, sourcesRoot, outFile, classificationFile, sampleLabel] = process.argv.slice(2);
if (!root || !noiseFile || !sourcesRoot || !outFile) throw new Error("Usage: node recount.ts <split root> <noise.json> <sources dir> <out file> [<classification.json> <sample label>]");
if (existsSync(outFile)) throw new Error(`${outFile} exists: a result is never overwritten.`);
const productionFile = join(root, "packages/cli/src/security/production.ts");
const { productionSplit } = await import(productionFile);
const blob = (path: string) => { const c = readFileSync(path); return createHash("sha1").update(`blob ${c.length}\0`).update(c).digest("hex"); };

async function raw(repo: string, sha: string, file: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${repo} ${file}: HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 10_000 * attempt));
    }
  }
}

const noise = JSON.parse(readFileSync(noiseFile, "utf8"));
const misses: { repo: string; name: string; cause: string }[] = classificationFile ? JSON.parse(readFileSync(classificationFile, "utf8")).rows.filter((r: any) => r.sample.startsWith(sampleLabel ?? "")) : [];
const changed: { repo: string; name: string; now: string }[] = [], repos: any[] = [], missStatus: any[] = [];
let total = 0;
for (const r of noise.rows) {
  const source = sourceOf(sourcesRoot, r.repo, r.sha);
  const [manifest, lockText] = await Promise.all([raw(r.repo, r.sha, "package.json"), raw(r.repo, r.sha, "package-lock.json")]);
  const split = productionSplit(lockText, source, JSON.parse(manifest));
  const vulnerable: { name: string; versions: string[] }[] = [...r.ludion.production, ...r.ludion.dev_only];
  const copies = [...split.copies.values()];
  const prod = vulnerable.filter(v => copies.some((c: any) => c.name === v.name && v.versions.includes(c.version) && c.production)).map(v => v.name);
  const was = new Set(r.ludion.production.map((v: any) => v.name));
  for (const name of was) if (!prod.includes(name)) changed.push({ repo: r.repo, name, now: "left out" });
  for (const name of prod) if (!was.has(name)) changed.push({ repo: r.repo, name, now: "counted" });
  total += prod.length;
  repos.push({ repo: r.repo, measured: r.ludion.count, recomputed: prod.length, split: split.summary });
  for (const m of misses.filter(m => m.repo === r.repo)) {
    const mine = copies.filter((c: any) => c.name === m.name);
    missStatus.push({ repo: m.repo, name: m.name, cause: m.cause, counted: prod.includes(m.name), osv_named: vulnerable.some(v => v.name === m.name), copies: mine.map((c: any) => ({ path: c.path, version: c.version, production: c.production, why: c.why })) });
  }
}
const result = {
  note: "Beside the result, never instead of it.", noise: noiseFile, production_ts_blob: blob(productionFile), measured_total: noise.totals.judge_production, recomputed_total: total,
  misses: { listed: misses.length, counted: missStatus.filter(m => m.counted).length, not_counted: missStatus.filter(m => !m.counted).map(m => `${m.repo} ${m.name}`) },
  changed, miss_status: missStatus, repos,
};
writeFileSync(outFile, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ measured_total: result.measured_total, recomputed_total: total, changed: changed.length, misses: result.misses }));
