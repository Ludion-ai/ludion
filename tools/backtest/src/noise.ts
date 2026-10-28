// Noise measurement, gate 1's production/dev split (docs/decisions.md, "Noise measurement: definitions fixed before
// running it"). For public repositories with Dependabot npm PRs, at their default branch's head: npm audit's count
// against the number of vulnerable packages the judge's split keeps as production. Nothing here runs project code:
// npm audit gets only package.json and package-lock.json, with its own npmrc, scripts off.
//
// The search runs first, outside this script, with gh (which keeps its own credentials), one query per UTC hour of
// 2026-10-27, saved as <out-dir>/search/hour-HH.json:
//   gh api graphql -f q='is:pr is:public author:app/dependabot label:javascript created:2026-10-27THH:00:00Z..2026-10-27THH:59:59Z sort:created-desc' -f query="$(SEARCH below)"
//
// Usage: node tools/backtest/src/noise.ts <out-dir>                 the run, from the saved search
//        node tools/backtest/src/noise.ts <out-dir> --local <dir>   one local checkout (a smoke test, not a result)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockEntries } from "../../../packages/cli/src/security/judge.ts";
import { osvIds } from "../../../packages/cli/src/security/npm-facts.ts";

const [outDir, flag, localDir] = process.argv.slice(2);
if (!outDir) throw new Error("Usage: node tools/backtest/src/noise.ts <out-dir> [--local <dir>]");
mkdirSync(outDir, { recursive: true });

const SAMPLE = 100;
/** The search window: Dependabot npm PRs created in each UTC hour of this day, the first 100 per hour, newest first. */
const DAY = "2026-10-27";
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const MAX_LOCK_BYTES = 50 * 1024 * 1024;

type Candidate = { repo: string; owner: string; sha: string; pr: string; pr_created: string; head_ref: string; lock_bytes: number | null; manifest_bytes: number | null; fork: boolean; archived: boolean; template: boolean };
type Vulnerable = { name: string; versions: string[]; ids: string[]; production: boolean };
type NpmAudit = { total: number; by_severity: Record<string, number>; direct: { name: string; severity: string; advisories: { url: string; range: string; title: string }[]; nodes: string[] }[] };
type Row = {
  repo: string; sha: string; pr: string; lockfile_version: number; installed_entries: number; versions_queried: number;
  npm: NpmAudit; npm_omit_dev_total: number;
  ludion: { count: number; production: Vulnerable[]; dev_only: Vulnerable[] };
  /** Vulnerable names (npm audit's direct findings, or OSV) that the judge's count leaves out: what the review checks. */
  left_out: { name: string; why: "dev-only per lockfile" | "OSV names no advisory for the installed versions"; npm_advisories: string[]; osv_ids: string[]; versions: string[] }[];
};
type Excluded = { repo: string; pr: string; reason: string };

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
    try { body = JSON.parse(r.stdout); } catch { throw new Error(`npm audit printed no JSON (exit ${r.status}): ${r.stderr.slice(0, 300)}`); }
    if (body?.error) throw new Error(`npm audit: ${body.error.code ?? ""} ${String(body.error.summary ?? "").slice(0, 300)}`);
    if (typeof body?.metadata?.vulnerabilities?.total !== "number" || typeof body.vulnerabilities !== "object") throw new Error("npm audit: unexpected report shape.");
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

/** The judge's split: a vulnerable version is production unless every installed copy of it is dev (judge.ts, lockDiff). */
async function ludion(lock: string) {
  const entries = lockEntries(lock);
  const versions = new Map<string, { name: string; version: string; production: boolean }>();
  for (const e of entries) {
    const key = `${e.name}@${e.version}`;
    const v = versions.get(key) ?? { name: e.name, version: e.version, production: false };
    v.production ||= !e.dev;
    versions.set(key, v);
  }
  const ids = await osvIds([...versions.values()].map(v => ({ name: v.name, version: v.version })));
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
  return { entries: entries.length, versions: versions.size, production: all.filter(v => v.production), dev_only: all.filter(v => !v.production) };
}

async function measure(repo: string, sha: string, pr: string, manifest: string, lock: string): Promise<Row> {
  const lockfileVersion = Number(JSON.parse(lock).lockfileVersion);
  const l = await ludion(lock);
  const npm = readAudit(npmAudit(manifest, lock, false));
  const omitDev = npmAudit(manifest, lock, true).metadata.vulnerabilities.total;
  const counted = new Set(l.production.map(v => v.name));
  const left = new Map<string, Row["left_out"][number]>();
  for (const v of l.dev_only) left.set(v.name, { name: v.name, why: "dev-only per lockfile", npm_advisories: [], osv_ids: v.ids, versions: v.versions });
  for (const d of npm.direct) {
    if (counted.has(d.name)) continue;
    const item = left.get(d.name) ?? { name: d.name, why: "OSV names no advisory for the installed versions" as const, npm_advisories: [], osv_ids: [], versions: [] };
    item.npm_advisories = d.advisories.map(a => a.url);
    left.set(d.name, item);
  }
  return {
    repo, sha, pr, lockfile_version: lockfileVersion, installed_entries: l.entries, versions_queried: l.versions,
    npm, npm_omit_dev_total: omitDev,
    ludion: { count: l.production.length, production: l.production, dev_only: l.dev_only },
    left_out: [...left.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The GraphQL query the saved search used (see the header). */
export const SEARCH = `query($q: String!) {
  search(type: ISSUE, query: $q, first: 100) {
    issueCount
    nodes { ... on PullRequest { url createdAt headRefName author { login }
      repository { nameWithOwner owner { login } isFork isArchived isTemplate isPrivate
        defaultBranchRef { target { oid } }
        lock: object(expression: "HEAD:package-lock.json") { ... on Blob { byteSize } }
        manifest: object(expression: "HEAD:package.json") { ... on Blob { byteSize } } } } }
  }
}`;

/** Candidates in a fixed order: rank 1 of every hour (00 to 23), then rank 2 of every hour, and so on; each repository once. */
function candidates(): Candidate[] {
  const hours = HOURS.map(h => {
    const file = join(outDir!, "search", `hour-${h}.json`);
    if (!existsSync(file)) throw new Error(`Missing ${file}; run the search first.`);
    const body = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(body?.data?.search?.nodes)) throw new Error(`${file} is not a search result.`);
    return body.data.search.nodes as any[];
  });
  const out: Candidate[] = [], seen = new Set<string>();
  for (let rank = 0; rank < Math.max(...hours.map(h => h.length)); rank++) {
    for (const nodes of hours) {
      const n = nodes[rank], r = n?.repository;
      if (!r || r.isPrivate || n.author?.login !== "dependabot" || !String(n.headRefName).startsWith("dependabot/npm_and_yarn/")) continue;
      if (seen.has(r.nameWithOwner)) continue;
      seen.add(r.nameWithOwner);
      out.push({ repo: r.nameWithOwner, owner: r.owner.login, sha: r.defaultBranchRef?.target?.oid ?? "", pr: n.url, pr_created: n.createdAt, head_ref: n.headRefName, lock_bytes: r.lock?.byteSize ?? null, manifest_bytes: r.manifest?.byteSize ?? null, fork: r.isFork, archived: r.isArchived, template: r.isTemplate });
    }
  }
  return out;
}

async function raw(repo: string, sha: string, file: string): Promise<string> {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${file}`, { redirect: "error" });
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.text();
}

const npmVersion = spawnSync("npm", ["--version"], { encoding: "utf8" }).stdout.trim();
const started = new Date().toISOString();

if (flag === "--local") {
  if (!localDir) throw new Error("--local needs a directory.");
  const row = await measure(localDir, "local", "", readFileSync(join(localDir, "package.json"), "utf8"), readFileSync(join(localDir, "package-lock.json"), "utf8"));
  writeFileSync(join(outDir, "smoke.json"), JSON.stringify({ note: "Smoke test on a local checkout; not a result.", npm: npmVersion, node: process.version, row }, null, 2));
  console.log(JSON.stringify({ npm_total: row.npm.total, npm_direct: row.npm.direct.length, npm_omit_dev_total: row.npm_omit_dev_total, ludion: row.ludion.count, dev_only: row.ludion.dev_only.length, left_out: row.left_out.length }));
} else {
  const rows: Row[] = [], excluded: Excluded[] = [], owners = new Set<string>();
  let considered = 0;
  const all = candidates();
  for (const c of all) {
    if (rows.length >= SAMPLE) break;
    considered++;
    const skip = (reason: string) => { excluded.push({ repo: c.repo, pr: c.pr, reason }); console.log(`skip ${c.repo}: ${reason}`); };
    if (owners.has(c.owner)) { skip("another repository of the same owner is already in the sample"); continue; }
    if (c.fork) { skip("fork"); continue; }
    if (c.archived) { skip("archived"); continue; }
    if (!c.sha) { skip("no default branch"); continue; }
    if (c.manifest_bytes === null || c.lock_bytes === null) { skip("no package.json and package-lock.json at the root"); continue; }
    if (c.lock_bytes > MAX_LOCK_BYTES) { skip("package-lock.json larger than 50 MB"); continue; }
    try {
      const [manifest, lock] = await Promise.all([raw(c.repo, c.sha, "package.json"), raw(c.repo, c.sha, "package-lock.json")]);
      const version = Number(JSON.parse(lock).lockfileVersion);
      if (version !== 2 && version !== 3) { skip(`lockfileVersion ${version}`); continue; }
      const row = await measure(c.repo, c.sha, c.pr, manifest, lock);
      if (row.npm.total < 1) { skip("npm audit reports 0 vulnerabilities"); continue; }
      owners.add(c.owner);
      rows.push(row);
      console.log(`${rows.length} ${c.repo}: npm ${row.npm.total}, judge ${row.ludion.count}`);
    } catch (e) {
      skip(`measurement failed: ${String((e as Error).message).slice(0, 300)}`);
    }
  }
  const npmTotal = rows.reduce((s, r) => s + r.npm.total, 0), judgeTotal = rows.reduce((s, r) => s + r.ludion.count, 0);
  writeFileSync(join(outDir, "noise.json"), JSON.stringify({
    started, finished: new Date().toISOString(), npm: npmVersion, node: process.version, day: DAY, sample: SAMPLE,
    repositories: rows.length, candidates: all.length, considered,
    totals: { npm_audit: npmTotal, judge_production: judgeTotal, npm_audit_omit_dev: rows.reduce((s, r) => s + r.npm_omit_dev_total, 0), npm_audit_direct: rows.reduce((s, r) => s + r.npm.direct.length, 0), left_out: rows.reduce((s, r) => s + r.left_out.length, 0) },
    count_gate: { rule: "judge_production <= npm_audit / 3", met: rows.length === SAMPLE && judgeTotal * 3 <= npmTotal },
    rows, excluded,
  }, null, 2));
  console.log(`done: ${rows.length} repositories, npm audit ${npmTotal}, judge ${judgeTotal}, considered ${considered}`);
}
