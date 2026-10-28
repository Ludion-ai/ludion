// L1c, reported beside the result (docs/decisions/2026-10-29-l1c-fix.md, "After #190's first review"): the split at
// another version of production.ts, recomputed offline over a measured sample's lockfiles and source trees, against
// that measurement's own production flags. The vulnerable versions are the measurement's own OSV results; nothing is
// queried, and no project code runs. It never replaces the result: it shows which (repository, package) pairs the
// other version would count differently.
//
// Usage, in Docker only (read-only root, non-root, no network, no forwarded environment):
//   docker run --rm --read-only --network none --user 1000:1000 --tmpfs /tmp -e HOME=/tmp -v <worktree at the version>:/w:ro \
//     -v <sources volume>:/src:ro -v <bench>:/b:ro -v <out>:/out node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 \
//     node /b/2026-10-29-l1c/scripts/beside.ts /w /b/2026-10-29-l1c/result-new/noise.json /out/beside-new.json
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [root, noiseFile, outFile] = process.argv.slice(2);
if (!root || !noiseFile || !outFile) throw new Error("Usage: node beside.ts <split root> <noise.json> <out file>");
const productionFile = join(root, "packages/cli/src/security/production.ts");
const { productionSplit, readSourceTree } = await import(productionFile);
const blob = (path: string) => { const c = readFileSync(path); return createHash("sha1").update(`blob ${c.length}\0`).update(c).digest("hex"); };

const noise = JSON.parse(readFileSync(noiseFile, "utf8"));
const changed: { repo: string; name: string; now: string }[] = [], repos: any[] = [];
let total = 0;
for (const r of noise.rows) {
  const dir = `/src/${r.repo.replace("/", "__")}`;
  const has = existsSync(join(dir, ".ludion-sha")) && readFileSync(join(dir, ".ludion-sha"), "utf8") === r.sha;
  const tree = has ? readSourceTree(dir) : null;
  const source = tree ? { ...tree, files: tree.files.filter((f: string) => f !== ".ludion-sha") } : null;
  if (has !== (r.split.source !== "not_given")) throw new Error(`${r.repo}: the source tree is ${has ? "here" : "missing"}, the measurement's split says ${r.split.source}`);
  // The measurement read package.json and package-lock.json from raw.githubusercontent.com at the same SHA; the
  // archive of that SHA holds the same files.
  if (!has) { repos.push({ repo: r.repo, measured: r.ludion.count, recomputed: null, note: "no source tree: not recomputed" }); total += r.ludion.count; continue; }
  const lockText = readFileSync(join(dir, "package-lock.json"), "utf8"), manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const split = productionSplit(lockText, source, manifest);
  const vulnerable: { name: string; versions: string[] }[] = [...r.ludion.production, ...r.ludion.dev_only];
  const prod = vulnerable.filter(v => [...split.copies.values()].some((c: any) => c.name === v.name && v.versions.includes(c.version) && c.production)).map(v => v.name);
  const was = new Set(r.ludion.production.map((v: any) => v.name));
  for (const name of was) if (!prod.includes(name)) changed.push({ repo: r.repo, name, now: "left out" });
  for (const name of prod) if (!was.has(name)) changed.push({ repo: r.repo, name, now: "counted" });
  total += prod.length;
  repos.push({ repo: r.repo, measured: r.ludion.count, recomputed: prod.length, split: split.summary });
}
writeFileSync(outFile, JSON.stringify({ note: "Beside the result, never instead of it.", noise: noiseFile, production_ts_blob: blob(productionFile), measured_total: noise.totals.judge_production, recomputed_total: total, changed, repos }, null, 1));
console.log(JSON.stringify({ measured_total: noise.totals.judge_production, recomputed_total: total, changed }));
