// L1d step 1: every miss of L1c (docs/bench/2026-10-29-l1c/review, the new 100: 58) and of the noise rerun
// (docs/bench/2026-10-28-noise-v2/review, the original 100: 11; L1c kept these verdicts), one row per (repository,
// package), with the cause the worker assigns and the reviewer's own evidence. The verdicts are the reviewers'; nothing
// here changes one. Reads committed files only; nothing is fetched or run.
// Usage, in Docker: node /w/docs/bench/2026-10-29-l1d/scripts/classify.mjs /w/docs/bench /out
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [bench, out] = process.argv.slice(2);
const verdicts = dir => readdirSync(dir).filter(f => /^verdicts-\d+\.json$/.test(f)).flatMap(f => JSON.parse(readFileSync(join(dir, f), "utf8")));
const evidence = (all, repo, name) => { for (const v of all) if (v.repo === repo) for (const p of v.packages) if (p.name === name) return p; return null; };

const CAUSES = {
  A: "The source came from GitHub's archive, which leaves out `export-ignore` files; the split read the partial tree as complete and used D2",
  B1: "A build or start command runs webpack's bin, which hands off to webpack-cli (named only in webpack's peerDependenciesMeta); webpack-cli's declared dependencies and peers reach the copy",
  B2: "`webpack serve` runs webpack's bin, which hands off to webpack-cli, which hands off to webpack-dev-server (named only in webpack-cli's or @webpack-cli/serve's peerDependenciesMeta); its dependencies reach the copy",
  B3: "The build and start commands load webpack.config.ts, which webpack-cli reads through a TypeScript register hook (ts-node, installed); ts-node's dependencies reach the copy",
  C1: "A require() whose argument is not a literal but holds one (`require(process.env.X || 'sharp')`)",
  C2: "A require.resolve() whose argument is a constant holding a literal (`const UPSTREAM = 'shadcn/tailwind.css'`)",
  C3: "A node_modules path built from literal segments (`path.join('node_modules', '@vscode', 'vsce', 'vsce')`)",
  D: "A build tool's configuration that P2's file list does not name (Umi's config/config.ts names @umijs/max-plugin-openapi)",
};
const cause = (repo, name) => {
  if (repo === "eighteen73/pulsar-extensions") return "A";
  if (repo === "STRML/strml.net" || repo === "ccnmtl/specialneedsvisit-pack" || repo === "carlostighe/modalMap") return "B1";
  if (repo === "timmson/agile-impact-map") return "B2";
  if (repo === "opencast/studio") return name === "diff" ? "B3" : "B2";
  if (repo === "acekyd/acekyd") return "C1";
  if (repo === "BilLogic/uno-blueprint") return "C2";
  if (repo === "ASIL-E-Hatake/vscode-games") return "C3";
  if (repo === "stop-bullshit/luckyh-cloud-web") return "D";
  throw new Error(`no cause for ${repo} ${name}`);
};

const rows = [];
const l1c = JSON.parse(readFileSync(join(bench, "2026-10-29-l1c/review/review-tally.json"), "utf8")).new;
const l1cVerdicts = verdicts(join(bench, "2026-10-29-l1c/review"));
for (const m of l1c.missed) rows.push({ sample: "second (L1c new 100)", repo: m.repo, name: m.name, verdict: m.verdict, criterion: m.criterion, source: "docs/bench/2026-10-29-l1c/review", evidence: evidence(l1cVerdicts, m.repo, m.name)?.evidence ?? null });
const v2 = JSON.parse(readFileSync(join(bench, "2026-10-28-noise-v2/review/review-tally.json"), "utf8"));
const v2Verdicts = verdicts(join(bench, "2026-10-28-noise-v2/review"));
for (const r of v2.repositories) for (const k of ["yes", "undecidable"]) for (const n of r[k]) {
  const name = typeof n === "string" ? n : n.name, p = evidence(v2Verdicts, r.repo, name);
  rows.push({ sample: "original (noise rerun, kept by L1c)", repo: r.repo, name, verdict: k, criterion: p?.criterion ?? null, source: "docs/bench/2026-10-28-noise-v2/review", evidence: p?.evidence ?? null });
}
const BASIS = {
  B1: r => r.repo === "carlostighe/modalMap" ? "build `webpack … -p` runs webpack 5.104.1's bin, which runs webpack-cli 3.3.11; webpack-cli declares the nested copy" : "build `webpack` runs webpack's bin, which runs webpack-cli 7.2.x (named only in webpack's peerDependenciesMeta); webpack-cli's peerDependencies name webpack-dev-server, which reaches the copy",
  B2: r => r.repo === "timmson/agile-impact-map" ? "start `npx webpack serve`: webpack 5.105.0's bin → webpack-cli 4.9.2 (peerDependenciesMeta of webpack) → webpack-dev-server 6.0.0 (peerDependenciesMeta of webpack-cli and @webpack-cli/serve) → the copy" : "start `webpack serve`: webpack 5.108.3's bin → webpack-cli 6.0.1 (peerDependenciesMeta of webpack) → webpack-dev-server 5.2.6 (peerDependenciesMeta of webpack-cli and @webpack-cli/serve) → the copy",
  B3: () => "webpack.config.ts is read by webpack-cli through interpret/rechoir with ts-node 10.9.2 (root devDependency); ts-node declares diff 4.0.2",
  C1: () => "scripts/generate-og-cards.mjs:12 `require(process.env.SHARP_PATH || 'sharp')`, run by og:cards",
  C2: () => "scripts/check-vendored-css.mjs:49 `const UPSTREAM = 'shadcn/tailwind.css'`, :124 `require.resolve(UPSTREAM)`; shadcn 4.18.0's dependencies reach the copy",
  C3: () => "scripts/test-package.ts:26 `join('node_modules', '@vscode', 'vsce', 'vsce')`, :27 runs it; @vscode/vsce 4.0.0's dependencies reach the copy",
  D: () => "config/config.ts:194 `plugins: ['@umijs/max-plugin-openapi', …]` (Umi's configuration for `max build`); the plugin declares @umijs/openapi → mockjs",
  A: r => "start/build `wp-scripts …` (P5/P6) → " + (/Dependency path\(s\) from the production copy: (.*?)\.(?: |$)/.exec(r.evidence)?.[1] ?? "(see evidence)"),
};
for (const r of rows) { r.cause = cause(r.repo, r.name); if (!r.evidence) throw new Error(`no evidence for ${r.repo} ${r.name}`); r.basis = BASIS[r.cause](r); }
if (rows.length !== 69) throw new Error(`expected 69 misses, found ${rows.length}`);

const byCause = {};
for (const r of rows) (byCause[r.cause] ??= { cause: CAUSES[r.cause], misses: 0, packages: [] }).misses++, byCause[r.cause].packages.push(`${r.repo} ${r.name}`);
writeFileSync(join(out, "classification.json"), JSON.stringify({ causes: CAUSES, by_cause: byCause, rows }, null, 1));
const md = ["| # | Sample | Repository | Package | Verdict | Cause | Basis |", "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map((r, i) => `| ${i + 1} | ${r.sample.split(" ")[0]} | ${r.repo} | ${r.name} | ${r.verdict}${r.criterion && r.criterion !== "none" ? ` (${r.criterion})` : ""} | ${r.cause} | ${r.basis.replace(/\|/g, "\\|")} |`)];
writeFileSync(join(out, "classification-table.md"), md.join("\n") + "\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(byCause).map(([k, v]) => [k, v.misses]))));
