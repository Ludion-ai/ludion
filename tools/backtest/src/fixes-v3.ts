// Backtest v3, genuine fixes (docs/decisions.md, "Backtest v3: definitions fixed before running it", section 6).
// The rerun's sample and delay formula (fixes.ts), judged with the time cap:
// - rule 1: A@x's production tree resolved as of T (each requirement on the highest non-prerelease version published
//   before T) with no lockfile; a requirement nothing before T satisfies stops the update (an upper bound: a real
//   lockfile can already hold a later version);
// - rule 2: by the judge, from A@x's dependencies that A@from did not declare.
//
// Usage: node tools/backtest/src/fixes-v3.ts <osv-npm-dir> <cache-dir> <out.json> [sample-size]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { judge, registryTarball, type Change } from "../../../packages/cli/src/security/judge.ts";
import { gatherFacts } from "../../../packages/cli/src/security/npm-facts.ts";

const [osvDir, cacheDir, outFile, size = "200"] = process.argv.slice(2);
if (!osvDir || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/fixes-v3.ts <osv-npm-dir> <cache-dir> <out.json> [sample-size]");
const SAMPLE = Number(size);
mkdirSync(join(cacheDir, "registry"), { recursive: true });

// The sample, exactly as fixes.ts draws it.
type Candidate = { id: string; name: string; fixed: string; key: string; advisoryPublished: string };
const candidates: Candidate[] = [];
for (const file of readdirSync(osvDir)) {
  if (!file.startsWith("GHSA-")) continue;
  const record = JSON.parse(readFileSync(join(osvDir, file), "utf8"));
  if (typeof record.published !== "string" || !record.published.startsWith("2025") || record.withdrawn) continue;
  for (const affected of record.affected ?? []) {
    if (affected?.package?.ecosystem !== "npm") continue;
    for (const range of affected.ranges ?? []) for (const event of range.events ?? []) {
      if (typeof event.fixed !== "string" || !semver.valid(event.fixed) || semver.prerelease(event.fixed)) continue;
      const key = createHash("sha256").update(`${record.id}\0${affected.package.name}\0${event.fixed}`).digest("hex");
      candidates.push({ id: record.id, name: affected.package.name, fixed: event.fixed, key, advisoryPublished: record.published });
    }
  }
}
candidates.sort((a, b) => a.key.localeCompare(b.key));

// Registry documents, compacted as in malicious-v3.ts (same cache).
type Req = Record<string, string>;
type Doc = { created: string | null; time: Record<string, string>; versions: Record<string, { d?: Req; o?: Req; p?: Req; po?: string[]; b?: string[]; s?: boolean }> };
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const registryPath = (name: string) => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Ludion-Backtest" }, signal: AbortSignal.timeout(300_000) }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) return res.json();
    if (attempt < 4) { await new Promise(r => setTimeout(r, 3_000 * (attempt + 1))); continue; }
    throw new Error(`${url}: ${res?.status ?? "no response"}`);
  }
}
const memo = new Map<string, Promise<Doc | null | "error">>();
function doc(name: string): Promise<Doc | null | "error"> {
  if (!memo.has(name)) memo.set(name, (async () => {
    if (!NAME.test(name)) return "error";
    const file = join(cacheDir!, "registry", `${encodeURIComponent(name)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    let raw: any;
    try { raw = await getJson(`https://registry.npmjs.org/${registryPath(name)}`); } catch (error) { console.error(String(error)); return "error"; }
    if (!raw) return null;
    // Only the publish times and the requirement maps are read here; the cache file is written by malicious-v3.ts's
    // format, so a document fetched here is not cached (the other script owns that format).
    const out: Doc = { created: null, time: {}, versions: {} };
    for (const [k, v] of Object.entries(raw.time ?? {})) if (typeof v === "string" && semver.valid(k)) out.time[k] = v;
    for (const [k, v] of Object.entries<any>(raw.versions ?? {})) {
      const pick = (o: unknown) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length ? Object.fromEntries(Object.entries(o).filter(([, s]) => typeof s === "string")) as Req : undefined;
      const optionalPeers = Object.entries<any>(v?.peerDependenciesMeta ?? {}).filter(([, m]) => m?.optional).map(([n]) => n);
      const bundled = Array.isArray(v?.bundleDependencies) ? v.bundleDependencies : Array.isArray(v?.bundledDependencies) ? v.bundledDependencies : undefined;
      out.versions[k] = { d: pick(v?.dependencies), o: pick(v?.optionalDependencies), p: pick(v?.peerDependencies), ...(optionalPeers.length ? { po: optionalPeers } : {}), ...(bundled?.length ? { b: bundled.filter((x: unknown) => typeof x === "string") } : {}) };
    }
    return out;
  })());
  return memo.get(name)!;
}
async function pool<T, R>(items: T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]!); } }));
  return out;
}
function parseSpec(name: string, spec: string): { name: string; range: string } | "skip" | null {
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.*))?$/.exec(spec);
  if (alias) return { name: alias[1]!, range: alias[2] || "*" };
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:)|^[^@\s]+\/[^@\s]+(?:#.*)?$/.test(spec)) return "skip";
  if (spec === "" || spec === "latest") return { name, range: "*" };
  return semver.validRange(spec) ? { name, range: spec } : null;
}
function highestBefore(d: Doc, range: string, t: number): string | null {
  // Every version published, including those since removed: they could be installed at the time.
  return semver.maxSatisfying(Object.keys(d.time).filter(v => Date.parse(d.time[v] ?? "") < t), range);
}
/** Rule 1 on a fresh resolution of A@x as of T: requirements nothing before T satisfies, and branches not readable. */
async function rule1(name: string, version: string, t: number): Promise<{ unsatisfiable: string[]; unknown: string[]; nodes: number }> {
  const out = { unsatisfiable: [] as string[], unknown: [] as string[], nodes: 0 };
  const seen = new Set<string>();
  let frontier = [{ name, version }];
  while (frontier.length && out.nodes <= 20_000) {
    await pool([...new Set(frontier.map(n => n.name))], 16, n => doc(n));
    const next = new Map<string, { name: string; range: string }>();
    for (const node of frontier) {
      const key = `${node.name}@${node.version}`;
      if (seen.has(key)) continue;
      seen.add(key); out.nodes++;
      const d = await doc(node.name);
      if (d === null || d === "error" || !d.versions[node.version]) { out.unknown.push(key); continue; }
      const m = d.versions[node.version]!;
      const reqs: Req = { ...m.p, ...m.o, ...m.d };
      for (const optional of m.po ?? []) if (!m.d?.[optional] && !m.o?.[optional]) delete reqs[optional];
      for (const b of m.b ?? []) delete reqs[b];
      for (const [depName, spec] of Object.entries(reqs)) {
        const parsed = parseSpec(depName, spec);
        if (parsed === "skip") continue;
        if (!parsed) { out.unknown.push(`${key} -> ${depName}@${spec}`); continue; }
        next.set(`${parsed.name}\0${parsed.range}`, parsed);
      }
    }
    frontier = [];
    await pool([...new Set([...next.values()].map(n => n.name))], 16, n => doc(n));
    for (const n of next.values()) {
      const d = await doc(n.name);
      if (d === null || d === "error") { out.unknown.push(`${n.name}@${n.range}`); continue; }
      const chosen = highestBefore(d, n.range, t);
      if (!chosen) { out.unsatisfiable.push(`${n.name}@${n.range}`); continue; }
      if (!seen.has(`${n.name}@${chosen}`)) frontier.push({ name: n.name, version: chosen });
    }
  }
  if (out.nodes > 20_000) out.unknown.push("tree larger than 20,000 versions");
  return out;
}

type Row = { id: string; name: string; from: string; to: string; fix_published: string; advisory_published: string; added_delay_hours: number | null; verdict: string; urgency: string; wait_hours: number; stops: string[]; rule1_unsatisfiable: string[]; rule1_unknown: number; rule2_young: string[]; tree_versions: number };
const rows: Row[] = [], skipped: Record<string, number> = { fix_not_published_2025: 0, no_earlier_version: 0, registry: 0, facts: 0, duplicate: 0 };
const seen = new Set<string>();
for (const c of candidates) {
  if (rows.length >= SAMPLE) break;
  if (seen.has(`${c.name}@${c.fixed}`)) { skipped.duplicate!++; continue; }
  seen.add(`${c.name}@${c.fixed}`);
  const d = await doc(c.name);
  if (!d || d === "error") { skipped.registry!++; continue; }
  const published = d.time[c.fixed];
  if (!published?.startsWith("2025")) { skipped.fix_not_published_2025!++; continue; }
  const from = Object.keys(d.time).filter(v => !semver.prerelease(v) && semver.lt(v, c.fixed) && semver.major(v) === semver.major(c.fixed) && Date.parse(d.time[v]!) < Date.parse(published)).sort(semver.rcompare)[0];
  if (!from) { skipped.no_earlier_version!++; continue; }
  const change: Change = { path: `node_modules/${c.name}`, name: c.name, from, to: c.fixed, dev: false, resolved: registryTarball(c.name, c.fixed), integrity: "sha512-backtest", replaced: null };
  let gathered;
  try { gathered = await gatherFacts([change]); } catch (error) { skipped.facts!++; console.error(`${c.name}@${c.fixed}: ${String(error)}`); continue; }
  const result = judge({ changes: [change], facts: gathered.facts, fixes: gathered.fixes, created: gathered.created, direct: [c.name], files: ["package-lock.json"], now: new Date("2100-01-01T00:00:00Z") });
  const tree = await rule1(c.name, c.fixed, Date.parse(published));
  const stops = [
    ...result.findings.filter(f => f.effect === "stop" && f.gate !== 4).map(f => f.message),
    ...tree.unsatisfiable.map(r => `Time cap: no version of ${r} was published before the fix (T = ${published}).`),
  ];
  rows.push({
    id: c.id, name: c.name, from, to: c.fixed, fix_published: published, advisory_published: c.advisoryPublished,
    added_delay_hours: stops.length ? null : Math.max(0, Math.round((Date.parse(published) + result.wait_hours * 3_600_000 - Date.parse(c.advisoryPublished)) / 360_000) / 10),
    verdict: stops.length ? "stop" : "ready_except_build", urgency: result.urgency, wait_hours: result.wait_hours, stops,
    rule1_unsatisfiable: tree.unsatisfiable, rule1_unknown: tree.unknown.length, rule2_young: result.time_cap.young, tree_versions: tree.nodes,
  });
  if (rows.length % 20 === 0) console.log(`${rows.length}/${SAMPLE}`);
}

const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const URG = ["exploited", "high", "normal", "low"];
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/src/fixes-v3.ts and docs/decisions.md, \"Backtest v3: definitions fixed before running it\".",
  candidates: candidates.length, sample: rows.length, skipped,
  stopped: count(r => r.verdict === "stop"),
  stopped_by: {
    rule1_unsatisfiable: count(r => r.rule1_unsatisfiable.length > 0),
    rule1_only: count(r => r.rule1_unsatisfiable.length > 0 && r.stops.length === r.rule1_unsatisfiable.length),
    rule2_young: count(r => r.rule2_young.length > 0),
    rule2_only: count(r => r.rule2_young.length > 0 && r.stops.every(s => s.startsWith("New dependency"))),
  },
  rule1_trees_with_unknown_branch: count(r => r.rule1_unknown > 0),
  by_urgency: Object.fromEntries(URG.map(u => [u, count(r => r.urgency === u)])),
  added_delay_by_urgency: Object.fromEntries(URG.map(u => {
    const d = rows.filter(r => r.urgency === u && r.added_delay_hours !== null).map(r => r.added_delay_hours!).sort((a, b) => a - b);
    return [u, { n: d.length, median: d[Math.floor(d.length / 2)] ?? null, p90: d[Math.floor(d.length * 0.9)] ?? null, stopped: count(r => r.urgency === u && r.verdict === "stop") }];
  })),
  advisory_before_fix: count(r => Date.parse(r.advisory_published) < Date.parse(r.fix_published)),
  caveats: [
    "Deprecation, provenance and publisher are today's registry facts, not those of the time; a later deprecation counts as a stop.",
    "Urgency uses today's CISA KEV list and today's EPSS score.",
    "Rule 1 resolves the fix's tree with no lockfile: an upper bound on its stops, since a real lockfile can already hold a later version.",
    "Gate 3 (build and test) is not part of the delay.",
  ],
  rows,
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify(shown, null, 2));
