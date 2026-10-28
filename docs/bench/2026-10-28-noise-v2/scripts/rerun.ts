// The noise rerun (docs/decisions.md, "Gate 1's production/dev split, rebuilt; the noise rerun's definitions", section
// 4): the first run's 100 repositories at their recorded SHAs, in the same order, with both counts recomputed now.
// npm audit's count as registered for the first run; the judge's count with the rebuilt split (production.ts) over
// the lockfile and the source tree at the recorded SHA. Nothing here runs project code: npm audit gets only
// package.json and package-lock.json, with its own npmrc and scripts off, and the source tree is read as text.
//
// Usage, in Docker only (read-only root, non-root, no forwarded environment), with the worktree at the registered
// commit and its node_modules at /w, the extracted sources (scripts/sources.mjs) read-only at /src, the output at /out:
//   docker run --rm --read-only --user 1000:1000 --tmpfs /tmp -e HOME=/tmp -v ludion-l1-wt:/w:ro -v ludion-l1-src:/src:ro \
//     -v <out>:/out node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 \
//     node /w/docs/bench/2026-10-28-noise-v2/scripts/rerun.ts /out --commit <sha>
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockEntries } from "../../../../packages/cli/src/security/judge.ts";
import { osvIds } from "../../../../packages/cli/src/security/npm-facts.ts";
import { productionSplit, readSourceTree, type Split } from "../../../../packages/cli/src/security/production.ts";

const [outDir, flag, commit] = process.argv.slice(2);
if (!outDir || flag !== "--commit" || !commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("Usage: node rerun.ts <out-dir> --commit <40-character sha>");
if (existsSync(join(outDir, "noise.json"))) throw new Error(`${join(outDir, "noise.json")} exists: a result is never overwritten; use a new folder.`);
mkdirSync(outDir, { recursive: true });

const NPM_VERSION = "11.19.1";
const ATTEMPTS = 3;
/** The first run's output (3105fac): its rows are the sample, in order. */
const first = JSON.parse(readFileSync(new URL("../../2026-10-28-noise/noise.json", import.meta.url), "utf8"));
/** Measured beside the sample, not in it: excluded from the first run for the lockfile reader's refusal. */
const BESIDE = [{ repo: "JakeWharton/jakewharton.com", sha: "c660e5960d205157ad6f5f50fc8eae7e93eb4116", pr: "https://github.com/JakeWharton/jakewharton.com/pull/291" }];

type Vulnerable = { name: string; versions: string[]; ids: string[]; production: boolean };
type NpmAudit = { total: number; by_severity: Record<string, number>; direct: { name: string; severity: string; advisories: { url: string; range: string; title: string }[]; nodes: string[] }[] };
type LeftOut = { name: string; reasons: string[]; osv_ids: string[]; osv_versions: string[]; npm_advisories: { url: string; range: string }[]; npm_nodes: string[]; copies: { path: string; version: string; dev: boolean; production: boolean; why: string }[] };

const stage = (name: string, e: unknown) => Object.assign(new Error(`${name}: ${String((e as Error)?.message ?? e).slice(0, 300)}`), { stage: name });

function npmAudit(manifest: string, lock: string, omitDev: boolean): any {
  const dir = mkdtempSync(join(tmpdir(), "noise-"));
  try {
    writeFileSync(join(dir, "package.json"), manifest);
    writeFileSync(join(dir, "package-lock.json"), lock);
    const npmrc = join(dir, ".ludion-npmrc");
    writeFileSync(npmrc, "registry=https://registry.npmjs.org/\nignore-scripts=true\nfund=false\nupdate-notifier=false\n");
    const r = spawnSync("npm", ["audit", "--package-lock-only", "--json", ...(omitDev ? ["--omit=dev"] : [])], {
      cwd: dir, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 300_000,
      env: { PATH: process.env.PATH, HOME: dir, npm_config_userconfig: npmrc, npm_config_globalconfig: join(dir, "none"), npm_config_cache: join(tmpdir(), "npm-cache") },
    });
    let body: any;
    try { body = JSON.parse(r.stdout); } catch { throw stage("npm audit", new Error(`printed no JSON (exit ${r.status}): ${r.stderr.slice(0, 300)}`)); }
    if (body?.error) throw stage("npm audit", new Error(`${body.error.code ?? ""} ${String(body.error.summary ?? "").slice(0, 300)}`));
    if (typeof body?.metadata?.vulnerabilities?.total !== "number" || typeof body.vulnerabilities !== "object") throw stage("npm audit", new Error("unexpected report shape."));
    return body;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readAudit(body: any): NpmAudit {
  const direct: NpmAudit["direct"] = [];
  for (const v of Object.values<any>(body.vulnerabilities)) {
    const advisories = (v.via ?? []).filter((x: unknown) => x && typeof x === "object").map((a: any) => ({ url: String(a.url ?? ""), range: String(a.range ?? ""), title: String(a.title ?? "") }));
    if (advisories.length) direct.push({ name: v.name, severity: v.severity, advisories, nodes: v.nodes ?? [] });
  }
  direct.sort((a, b) => a.name.localeCompare(b.name));
  const { total, ...by_severity } = body.metadata.vulnerabilities;
  return { total, by_severity, direct };
}

/** The source tree at the recorded SHA (scripts/sources.mjs), or null when it was not extracted for that SHA. */
function sourceOf(repo: string, sha: string) {
  const dir = `/src/${repo.replace("/", "__")}`;
  if (!existsSync(join(dir, ".ludion-sha")) || readFileSync(join(dir, ".ludion-sha"), "utf8") !== sha) return null;
  const tree = readSourceTree(dir);
  // The marker is the fetch script's, not the repository's.
  return { ...tree, files: tree.files.filter(f => f !== ".ludion-sha") };
}

/** The judge's count with the rebuilt split: a vulnerable version is production when any installed copy of it is. */
async function ludion(repo: string, sha: string, manifest: string, lock: string) {
  let entries: ReturnType<typeof lockEntries>;
  try { entries = lockEntries(lock); } catch (e) { throw stage("judge lockfile reader", e); }
  const source = sourceOf(repo, sha);
  let split: Split;
  try { split = productionSplit(lock, source, JSON.parse(manifest)); } catch (e) { throw stage("judge split", e); }
  const versions = new Map<string, { name: string; version: string; production: boolean }>();
  for (const e of entries) {
    const key = `${e.name}@${e.version}`;
    const v = versions.get(key) ?? { name: e.name, version: e.version, production: false };
    v.production ||= split.copies.get(e.path)!.production;
    versions.set(key, v);
  }
  let ids: Map<string, string[]>;
  try { ids = await osvIds([...versions.values()].map(v => ({ name: v.name, version: v.version }))); } catch (e) { throw stage("judge OSV lookup", e); }
  const byName = new Map<string, Vulnerable>();
  for (const [key, v] of versions) {
    const found = ids.get(key) ?? [];
    if (!found.length) continue;
    const n = byName.get(v.name) ?? { name: v.name, versions: [], ids: [], production: false };
    n.versions.push(v.version);
    for (const id of found) if (!n.ids.includes(id)) n.ids.push(id);
    n.production ||= v.production;
    byName.set(v.name, n);
  }
  const all = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { entries, split, source_files: source?.files.length ?? null, versions: versions.size, production: all.filter(v => v.production), dev_only: all.filter(v => !v.production) };
}

/** Shown, not gated: the rebuilt split applied to the first run's own OSV results for the same repository. */
function onFirstRunData(firstRow: any, split: Split): number {
  const all: Vulnerable[] = [...firstRow.ludion.production, ...firstRow.ludion.dev_only];
  return all.filter(v => [...split.copies.values()].some(c => c.name === v.name && v.versions.includes(c.version) && c.production)).length;
}

async function measure(repo: string, sha: string, pr: string, manifest: string, lock: string, attempts: number) {
  const l = await ludion(repo, sha, manifest, lock);
  const npm = readAudit(npmAudit(manifest, lock, false));
  const omitDev = npmAudit(manifest, lock, true).metadata.vulnerabilities.total;
  const counted = new Set(l.production.map(v => v.name));
  const copies = (name: string) => l.entries.filter(e => e.name === name).map(e => { const c = l.split.copies.get(e.path)!; return { path: e.path, version: e.version, dev: e.dev, production: c.production, why: c.why }; });
  const left = new Map<string, LeftOut>();
  for (const v of l.dev_only) left.set(v.name, { name: v.name, reasons: ["OSV: every installed copy of its vulnerable versions is dev-only by the split"], osv_ids: v.ids, osv_versions: v.versions, npm_advisories: [], npm_nodes: [], copies: copies(v.name) });
  for (const d of npm.direct) {
    if (counted.has(d.name)) continue;
    const item = left.get(d.name) ?? { name: d.name, reasons: ["OSV names no record for the installed versions"], osv_ids: [], osv_versions: [], npm_advisories: [], npm_nodes: [], copies: copies(d.name) };
    item.reasons.push("npm audit lists it");
    item.npm_advisories = d.advisories.map(a => ({ url: a.url, range: a.range }));
    item.npm_nodes = d.nodes;
    left.set(d.name, item);
  }
  return {
    repo, sha, pr, lockfile_version: Number(JSON.parse(lock).lockfileVersion), installed_entries: l.entries.length, versions_queried: l.versions, attempts,
    split: { ...l.split.summary, source_files: l.source_files, dev_only_versions: l.split.devOnly.size },
    npm, npm_omit_dev_total: omitDev,
    ludion: { count: l.production.length, production: l.production, dev_only: l.dev_only },
    left_out: [...left.values()].sort((a, b) => a.name.localeCompare(b.name)),
    split_obj: l.split,
  };
}

async function raw(repo: string, sha: string, file: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw stage("fetch", new Error(`${file}: HTTP ${res.status}`));
  return res.text();
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null; };
const npmVersion = spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim();
if (npmVersion !== NPM_VERSION) throw new Error(`npm ${npmVersion} is not the registered ${NPM_VERSION}; run in node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205.`);
const started = new Date().toISOString();
const log = (line: string) => { console.log(line); appendFileSync(join(outDir!, "run.log"), `${new Date().toISOString()} ${line}\n`); };
/** Git blob hashes of the code that computes the counts, so `git ls-tree <commit>` can check the logged commit. */
const blobs: Record<string, string> = Object.fromEntries(["docs/bench/2026-10-28-noise-v2/scripts/rerun.ts", "packages/cli/src/security/production.ts", "packages/cli/src/security/judge.ts", "packages/cli/src/security/npm-facts.ts", "packages/cli/src/security/time-cap.ts", "docs/bench/2026-10-28-noise/noise.json"].map(path => {
  const content = readFileSync(new URL(`../../../../${path}`, import.meta.url));
  return [path, createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex")];
}));
blobs["node_modules/semver (version)"] = JSON.parse(readFileSync(new URL("../../../../node_modules/semver/package.json", import.meta.url), "utf8")).version;
const sources = existsSync("/src/sources-log.json") ? JSON.parse(readFileSync("/src/sources-log.json", "utf8")) : null;
log(`start at ${started}, commit ${commit}, npm ${npmVersion}, node ${process.version}, blobs ${JSON.stringify(blobs)}, sources fetched at ${sources?.fetched_at ?? "unknown"}`);

try {
  type Row = Awaited<ReturnType<typeof measure>>;
  const rows: Omit<Row, "split_obj">[] = [], failed: { repo: string; reason: string }[] = [], same: { repo: string; first_run_judge: number; rebuilt_split_on_first_run_data: number }[] = [];
  const beside: unknown[] = [];
  for (const [i, c] of [...first.rows.map((r: any) => ({ repo: r.repo, sha: r.sha, pr: r.pr })), ...BESIDE].entries()) {
    const inSample = i < first.rows.length;
    let row: Row | null = null, last: any = null;
    for (let attempt = 1; attempt <= ATTEMPTS && !row; attempt++) {
      try {
        const [manifest, lock] = await Promise.all([raw(c.repo, c.sha, "package.json"), raw(c.repo, c.sha, "package-lock.json")]);
        row = await measure(c.repo, c.sha, c.pr, manifest, lock, attempt);
      } catch (e) {
        last = e;
        if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 15_000 * attempt));
      }
    }
    if (!row) { failed.push({ repo: c.repo, reason: `${last?.stage ?? "measurement"}: ${String(last?.message ?? last).slice(0, 300)}` }); log(`failed ${c.repo}: ${failed.at(-1)!.reason}`); continue; }
    const { split_obj, ...kept } = row;
    if (inSample) {
      rows.push(kept);
      const f = first.rows[i];
      same.push({ repo: c.repo, first_run_judge: f.ludion.count, rebuilt_split_on_first_run_data: onFirstRunData(f, split_obj) });
      log(`${rows.length} ${c.repo}: npm ${row.npm.total}, judge ${row.ludion.count} (first run: npm ${f.npm.total}, judge ${f.ludion.count}), split ${row.split.source}${row.split.images_with_dev.length ? ` image ${row.split.images_with_dev.join(",")}` : ""}, left out ${row.left_out.length}`);
    } else {
      beside.push(kept);
      log(`beside the sample: ${c.repo}: npm ${row.npm.total}, judge ${row.ludion.count}, split ${row.split.source}, left out ${row.left_out.length}`);
    }
  }
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  const npmTotal = sum(r => r.npm.total), judgeTotal = sum(r => r.ludion.count);
  writeFileSync(join(outDir, "noise.json"), JSON.stringify({
    started, finished: new Date().toISOString(), commit, blobs, npm: npmVersion, node: process.version, sources_fetched_at: sources?.fetched_at ?? null,
    sample: first.rows.length, repositories: rows.length, failed,
    totals: { npm_audit: npmTotal, judge_production: judgeTotal, npm_audit_omit_dev: sum(r => r.npm_omit_dev_total), npm_audit_direct: sum(r => r.npm.direct.length), left_out: sum(r => r.left_out.length) },
    count_gate: { rule: "judge_production <= npm_audit / 3", met: rows.length === first.rows.length && judgeTotal * 3 <= npmTotal },
    also_shown: {
      first_run: { npm_audit: first.totals.npm_audit, judge_production: first.totals.judge_production, npm_audit_omit_dev: first.totals.npm_audit_omit_dev, npm_audit_direct: first.totals.npm_audit_direct, left_out: first.totals.left_out },
      rebuilt_split_on_first_run_data: { judge_production: same.reduce((s, x) => s + x.rebuilt_split_on_first_run_data, 0), first_run_npm_audit: first.totals.npm_audit, per_repository: same },
      judge_over_npm_direct: sum(r => r.npm.direct.length) ? judgeTotal / sum(r => r.npm.direct.length) : null,
      judge_over_npm_omit_dev: sum(r => r.npm_omit_dev_total) ? judgeTotal / sum(r => r.npm_omit_dev_total) : null,
      per_repository_ratio_median: (m => m === Infinity ? "infinite" : m)(median(rows.filter(r => r.npm.total > 0 || r.ludion.count > 0).map(r => r.npm.total > 0 ? r.ludion.count / r.npm.total : Infinity))),
      repositories_without_a_ratio: rows.filter(r => r.npm.total === 0 && r.ludion.count === 0).length,
      repositories_npm_zero_judge_above_zero: rows.filter(r => r.npm.total === 0 && r.ludion.count > 0).length,
      repositories_at_or_below_a_third: rows.filter(r => (r.npm.total > 0 || r.ludion.count > 0) && r.ludion.count * 3 <= r.npm.total).length,
      splits: { source_read: rows.filter(r => r.split.source === "read" && !r.split.images_with_dev.length).length, image_holds_dev: rows.filter(r => r.split.images_with_dev.length).length, incomplete: rows.filter(r => r.split.source === "incomplete").length, not_given: rows.filter(r => r.split.source === "not_given").length },
    },
    rows, beside,
  }, null, 2));
  log(`done: ${rows.length} repositories, npm audit ${npmTotal}, judge ${judgeTotal}, failed ${failed.length}`);
} catch (e) {
  log(`stopped: ${String((e as Error)?.stack ?? e).slice(0, 2000)}`);
  throw e;
}
