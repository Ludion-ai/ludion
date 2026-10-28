// L1c (docs/decisions/2026-10-29-l1c-new-sample.md): the noise measurement with the fixed split, on the original 100
// repositories (the rerun's, at their recorded SHAs) or on the new sample (the search of 2026-10-26, chosen as the first
// run chose its sample, with no repository or owner of the original sample). Both counts are the first run's and the
// rerun's: npm audit's `metadata.vulnerabilities.total`, and the number of vulnerable package names with a production
// version by section 2's split over the root lockfile and the source tree. Nothing here runs project code: npm audit
// gets only package.json and package-lock.json, with its own npmrc and scripts off, and the source tree is read as text.
//
// Usage, in Docker only (read-only root, non-root, no forwarded environment), with the worktree at the registered commit
// and its node_modules at /w, the output at /out:
//   original: -v ludion-l1b-src:/src:ro                 node /w/docs/bench/2026-10-29-l1c/scripts/measure.ts /out original --commit <sha>
//   new:      -v <new sources volume>:/src (writable)   node /w/docs/bench/2026-10-29-l1c/scripts/measure.ts /out new --commit <sha>
// with node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205. For the new sample, each
// included candidate's source is fetched from GitHub's archive of the recorded SHA (codeload), extracted into
// /src/<owner>__<repo> with node_modules left out, never run, and logged (SHA-256, file count) in /out/sources-log.json.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockEntries } from "../../../../packages/cli/src/security/judge.ts";
import { osvIds } from "../../../../packages/cli/src/security/npm-facts.ts";
import { productionSplit, readSourceTree, type Split } from "../../../../packages/cli/src/security/production.ts";

const [outDir, sample, flag, commit] = process.argv.slice(2);
if (!outDir || (sample !== "original" && sample !== "new") || flag !== "--commit" || !commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error("Usage: node measure.ts <out-dir> (original | new) --commit <40-character sha>");
if (existsSync(join(outDir, "noise.json"))) throw new Error(`${join(outDir, "noise.json")} exists: a result is never overwritten; use a new folder.`);
mkdirSync(outDir, { recursive: true });

const SAMPLE = 100;
const NPM_VERSION = "11.19.1";
const ATTEMPTS = 3;
const MAX_LOCK_BYTES = 50 * 1024 * 1024;
const DAY = "2026-10-26";
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
/** The original sample: the first run's rows (3105fac), which the rerun measured in the same order. */
const first = JSON.parse(readFileSync(new URL("../../2026-10-28-noise/noise.json", import.meta.url), "utf8"));
/** No repository or owner of the original sample (and JakeWharton/jakewharton.com, measured beside it) is in the new one. */
const ORIGINAL = new Set<string>([...first.rows.map((r: any) => r.repo), "JakeWharton/jakewharton.com"]);
const ORIGINAL_OWNERS = new Set([...ORIGINAL].map(r => r.split("/")[0]!.toLowerCase()));

type Vulnerable = { name: string; versions: string[]; ids: string[]; production: boolean };
type NpmAudit = { total: number; by_severity: Record<string, number>; direct: { name: string; severity: string; advisories: { url: string; range: string; title: string }[]; nodes: string[] }[] };
type LeftOut = { name: string; reasons: string[]; osv_ids: string[]; osv_versions: string[]; npm_advisories: { url: string; range: string }[]; npm_nodes: string[]; copies: { path: string; version: string; dev: boolean; production: boolean; why: string }[] };
type Candidate = { repo: string; owner: string; sha: string; pr: string; lock_bytes: number | null; manifest_bytes: number | null; fork: boolean; archived: boolean };

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

const sourceDir = (repo: string) => `/src/${repo.replace("/", "__")}`;
/** The source tree at the recorded SHA, or null when it was not extracted for that SHA (then only D1 applies). */
function sourceOf(repo: string, sha: string) {
  const dir = sourceDir(repo);
  if (!existsSync(join(dir, ".ludion-sha")) || readFileSync(join(dir, ".ludion-sha"), "utf8") !== sha) return null;
  const tree = readSourceTree(dir);
  // The marker is the fetch's, not the repository's.
  return { ...tree, files: tree.files.filter(f => f !== ".ludion-sha") };
}

const count = (dir: string): number => { let n = 0; for (const d of readdirSync(dir, { withFileTypes: true })) { if (d.isDirectory()) n += count(join(dir, d.name)); else n++; } return n; };
/** The new sample's source: GitHub's archive of the recorded SHA, extracted with node_modules left out. Three attempts. */
async function fetchSource(repo: string, sha: string) {
  const dir = sourceDir(repo), tgz = `/src/.tmp-${repo.replace("/", "__")}.tgz`;
  let entry: any = null;
  for (let attempt = 1; attempt <= ATTEMPTS && !entry?.ok; attempt++) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      writeFileSync(tgz, body);
      execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1", "--exclude=*/node_modules/*", "--exclude=*/node_modules", "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
      writeFileSync(`${dir}/.ludion-sha`, sha);
      entry = { repo, sha, ok: true, attempt, archive_sha256: createHash("sha256").update(body).digest("hex"), archive_bytes: body.length, files: count(dir) - 1 };
    } catch (e) {
      entry = { repo, sha, ok: false, attempt, error: String((e as Error)?.message ?? e).slice(0, 300) };
      if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 10_000 * attempt));
    } finally { rmSync(tgz, { force: true }); }
  }
  if (!entry.ok) rmSync(dir, { recursive: true, force: true });
  return entry;
}

/** The judge's count with section 2's split: a vulnerable version is production when any installed copy of it is. */
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
  };
}
type Row = Awaited<ReturnType<typeof measure>>;

async function raw(repo: string, sha: string, file: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw stage("fetch", new Error(`${file}: HTTP ${res.status}`));
  return res.text();
}

/** The new sample's candidates, in the first run's order: rank 1 of every hour (00 to 23), then rank 2, and so on. */
function candidates(): Candidate[] {
  const hours = HOURS.map(h => {
    const file = new URL(`../search/hour-${h}.json`, import.meta.url);
    if (!existsSync(file)) throw new Error(`Missing search/hour-${h}.json; run the search first.`);
    const body = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(body?.data?.search?.nodes)) throw new Error(`search/hour-${h}.json is not a search result.`);
    return body.data.search.nodes as any[];
  });
  const out: Candidate[] = [], seen = new Set<string>();
  for (let rank = 0; rank < Math.max(...hours.map(h => h.length)); rank++) {
    for (const nodes of hours) {
      const n = nodes[rank], r = n?.repository;
      if (!r || r.isPrivate || n.author?.login !== "dependabot" || !String(n.headRefName).startsWith("dependabot/npm_and_yarn/")) continue;
      if (seen.has(r.nameWithOwner)) continue;
      seen.add(r.nameWithOwner);
      out.push({ repo: r.nameWithOwner, owner: r.owner.login, sha: r.defaultBranchRef?.target?.oid ?? "", pr: n.url, lock_bytes: r.lock?.byteSize ?? null, manifest_bytes: r.manifest?.byteSize ?? null, fork: r.isFork, archived: r.isArchived });
    }
  }
  return out;
}

/** Up to three attempts at both files and both counts; null with the last error, or the lockfile version that is not read. */
async function attempt(c: { repo: string; sha: string; pr: string }, before?: () => Promise<void>) {
  let row: Row | null = null, last: any = null, version = 0;
  for (let k = 1; k <= ATTEMPTS && !row; k++) {
    try {
      const [manifest, lock] = await Promise.all([raw(c.repo, c.sha, "package.json"), raw(c.repo, c.sha, "package-lock.json")]);
      version = Number(JSON.parse(lock).lockfileVersion);
      if (version !== 2 && version !== 3) break;
      if (before) { await before(); before = undefined; }
      row = await measure(c.repo, c.sha, c.pr, manifest, lock, k);
    } catch (e) {
      last = e;
      if (k < ATTEMPTS) await new Promise(r => setTimeout(r, 15_000 * k));
    }
  }
  return { row, last, version };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : null; };
const npmVersion = spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim();
if (npmVersion !== NPM_VERSION) throw new Error(`npm ${npmVersion} is not the registered ${NPM_VERSION}; run in node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205.`);
const started = new Date().toISOString();
const log = (line: string) => { console.log(line); appendFileSync(join(outDir!, "run.log"), `${new Date().toISOString()} ${line}\n`); };
/** Git blob hashes of the code that computes the counts, so `git ls-tree <commit>` can check the logged commit. */
const blobs: Record<string, string> = Object.fromEntries(["docs/bench/2026-10-29-l1c/scripts/measure.ts", "packages/cli/src/security/production.ts", "packages/cli/src/security/judge.ts", "packages/cli/src/security/npm-facts.ts", "packages/cli/src/security/time-cap.ts", "docs/bench/2026-10-28-noise/noise.json"].map(path => {
  const content = readFileSync(new URL(`../../../../${path}`, import.meta.url));
  return [path, createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex")];
}));
blobs["node_modules/semver (version)"] = JSON.parse(readFileSync(new URL("../../../../node_modules/semver/package.json", import.meta.url), "utf8")).version;
log(`start at ${started}, sample ${sample}, commit ${commit}, npm ${npmVersion}, node ${process.version}, blobs ${JSON.stringify(blobs)}`);

try {
  const rows: Row[] = [], excluded: { repo: string; pr: string; cause: string; reason: string; npm_total?: number; judge_count?: number }[] = [], failed: { repo: string; reason: string }[] = [];
  const sources: any[] = [];
  let considered = 0, candidateCount = 0;
  const line = (row: Row) => log(`${rows.length} ${row.repo}: npm ${row.npm.total}, judge ${row.ludion.count}, split ${row.split.source}${row.split.images_with_dev.length ? ` image ${row.split.images_with_dev.join(",")}` : ""}, left out ${row.left_out.length}`);
  if (sample === "original") {
    for (const c of first.rows.map((r: any) => ({ repo: r.repo, sha: r.sha, pr: r.pr }))) {
      const { row, last } = await attempt(c);
      if (!row) { failed.push({ repo: c.repo, reason: `${last?.stage ?? "measurement"}: ${String(last?.message ?? last).slice(0, 300)}` }); log(`failed ${c.repo}: ${failed.at(-1)!.reason}`); continue; }
      rows.push(row);
      line(row);
    }
  } else {
    const all = candidates(), owners = new Set<string>();
    candidateCount = all.length;
    for (const c of all) {
      if (rows.length >= SAMPLE) break;
      considered++;
      const skip = (cause: string, reason: string, counts: { npm_total?: number; judge_count?: number } = {}) => { excluded.push({ repo: c.repo, pr: c.pr, cause, reason, ...counts }); log(`skip ${c.repo}: ${cause}: ${reason}`); };
      if (ORIGINAL.has(c.repo) || ORIGINAL_OWNERS.has(c.owner.toLowerCase())) { skip("in the original sample", ORIGINAL.has(c.repo) ? "the repository is in the original sample" : "its owner owns a repository in the original sample"); continue; }
      if (owners.has(c.owner)) { skip("owner", "another repository of the same owner is already in the sample"); continue; }
      if (c.fork) { skip("fork", "fork"); continue; }
      if (c.archived) { skip("archived", "archived"); continue; }
      if (!c.sha) { skip("no default branch", "no default branch"); continue; }
      if (c.manifest_bytes === null || c.lock_bytes === null) { skip("no root lockfile", "no package.json and package-lock.json at the root"); continue; }
      if (c.lock_bytes > MAX_LOCK_BYTES) { skip("lockfile too large", "package-lock.json larger than 50 MB"); continue; }
      // The source is fetched once the lockfile is known to be read, before the counts (its failure means D1 only).
      const { row, last, version } = await attempt(c, async () => { const s = await fetchSource(c.repo, c.sha); sources.push(s); if (!s.ok) log(`source of ${c.repo} not fetched after ${ATTEMPTS} attempts (${s.error}): D1 only`); });
      if (!row && version !== 0 && version !== 2 && version !== 3) { skip(version === 1 ? "lockfile v1" : "lockfile other", `lockfileVersion ${version}`); continue; }
      if (!row) { skip(last?.stage ?? "measurement", `after ${ATTEMPTS} attempts: ${String(last?.message ?? last).slice(0, 300)}`); continue; }
      if (row.npm.total < 1 && row.ludion.production.length + row.ludion.dev_only.length === 0) { skip("nothing named", "neither npm audit nor OSV names an installed package", { npm_total: row.npm.total, judge_count: row.ludion.count }); continue; }
      owners.add(c.owner);
      rows.push(row);
      line(row);
    }
    writeFileSync(join(outDir, "sources-log.json"), JSON.stringify({ fetched_at: started, repositories: sources }, null, 1));
  }
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  const npmTotal = sum(r => r.npm.total), judgeTotal = sum(r => r.ludion.count);
  const causes: Record<string, number> = {};
  for (const x of excluded) causes[x.cause] = (causes[x.cause] ?? 0) + 1;
  writeFileSync(join(outDir, "noise.json"), JSON.stringify({
    started, finished: new Date().toISOString(), sample, commit, blobs, npm: npmVersion, node: process.version, ...(sample === "new" ? { day: DAY, candidates: candidateCount, considered, exclusions_by_cause: causes } : {}),
    repositories: rows.length, failed,
    totals: { npm_audit: npmTotal, judge_production: judgeTotal, npm_audit_omit_dev: sum(r => r.npm_omit_dev_total), npm_audit_direct: sum(r => r.npm.direct.length), left_out: sum(r => r.left_out.length) },
    count_gate: { rule: "judge_production <= npm_audit / 3", met: rows.length === SAMPLE && judgeTotal * 3 <= npmTotal },
    also_shown: {
      judge_over_npm_direct: sum(r => r.npm.direct.length) ? judgeTotal / sum(r => r.npm.direct.length) : null,
      judge_over_npm_omit_dev: sum(r => r.npm_omit_dev_total) ? judgeTotal / sum(r => r.npm_omit_dev_total) : null,
      per_repository_ratio_median: (m => m === Infinity ? "infinite" : m)(median(rows.filter(r => r.npm.total > 0 || r.ludion.count > 0).map(r => r.npm.total > 0 ? r.ludion.count / r.npm.total : Infinity))),
      repositories_without_a_ratio: rows.filter(r => r.npm.total === 0 && r.ludion.count === 0).length,
      repositories_npm_zero_judge_above_zero: rows.filter(r => r.npm.total === 0 && r.ludion.count > 0).length,
      repositories_at_or_below_a_third: rows.filter(r => (r.npm.total > 0 || r.ludion.count > 0) && r.ludion.count * 3 <= r.npm.total).length,
      splits: { source_read: rows.filter(r => r.split.source === "read" && !r.split.images_with_dev.length).length, image_holds_dev: rows.filter(r => r.split.images_with_dev.length).length, incomplete: rows.filter(r => r.split.source === "incomplete").length, not_given: rows.filter(r => r.split.source === "not_given").length },
    },
    rows, excluded,
  }, null, 2));
  log(`done: ${rows.length} repositories, npm audit ${npmTotal}, judge ${judgeTotal}, failed ${failed.length}${sample === "new" ? `, considered ${considered} ${JSON.stringify(causes)}` : ""}`);
} catch (e) {
  log(`stopped: ${String((e as Error)?.stack ?? e).slice(0, 2000)}`);
  throw e;
}
