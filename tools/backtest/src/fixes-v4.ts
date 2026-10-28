// Backtest v4, genuine fixes (docs/decisions.md, "Rule 1's same-release exception, and backtest v4's definitions").
// Backtest v3's sample, delay formula and rules (fixes-v3.ts), with rule 1's same-release exception in A@x's tree:
// each requirement resolves to the highest version rule 1 allows, published before T or published in [T, T + 24h) and
// the same release as A@x (time-cap.ts, sameRelease). The wait counts from the newest version in the tree. Every
// update is judged with the exception (primary) and without it (v3's rule), on the same data.
//
// Usage: node tools/backtest/src/fixes-v4.ts <osv-npm-dir> <cache-dir> <out.json> [sample-size]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { judge, registryTarball, releaseIdentity, type Change } from "../../../packages/cli/src/security/judge.ts";
import { gatherFacts, provenanceFrom, sharedPublisher } from "../../../packages/cli/src/security/npm-facts.ts";
import { SAME_RELEASE_MINUTES, sameRelease, type ReleaseIdentity, type SameRelease } from "../../../packages/cli/src/security/time-cap.ts";

const [osvDir, cacheDir, outFile, size = "200"] = process.argv.slice(2);
if (!osvDir || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/fixes-v4.ts <osv-npm-dir> <cache-dir> <out.json> [sample-size]");
const SAMPLE = Number(size);
for (const dir of ["registry", "identity", "attest"]) mkdirSync(join(cacheDir, dir), { recursive: true });
const H = 3_600_000;
/** How far after T the backtest looks for versions the exception allows (as in malicious-v4.ts). */
const HORIZON = 24 * H;

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

// Registry documents, compacted as in malicious-v4.ts (same cache).
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
    // Only the publish times and the requirement maps are read here; the cache file is written by malicious-v4.ts's
    // format, so a document fetched here is not cached (the other script owns that format). Its identities are.
    const out: Doc = { created: null, time: {}, versions: {} };
    for (const [k, v] of Object.entries(raw.time ?? {})) if (typeof v === "string" && semver.valid(k)) out.time[k] = v;
    for (const [k, v] of Object.entries<any>(raw.versions ?? {})) {
      const pick = (o: unknown) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length ? Object.fromEntries(Object.entries(o).filter(([, s]) => typeof s === "string")) as Req : undefined;
      const optionalPeers = Object.entries<any>(v?.peerDependenciesMeta ?? {}).filter(([, m]) => m?.optional).map(([n]) => n);
      const bundled = Array.isArray(v?.bundleDependencies) ? v.bundleDependencies : Array.isArray(v?.bundledDependencies) ? v.bundledDependencies : undefined;
      out.versions[k] = { d: pick(v?.dependencies), o: pick(v?.optionalDependencies), p: pick(v?.peerDependencies), ...(optionalPeers.length ? { po: optionalPeers } : {}), ...(bundled?.length ? { b: bundled.filter((x: unknown) => typeof x === "string") } : {}) };
    }
    saveIdentities(name, raw);
    return out;
  })());
  return memo.get(name)!;
}
async function pool<T, R>(items: T[], n: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]!); } }));
  return out;
}

// Publisher and provenance, as in malicious-v4.ts (same cache).
type Identities = Record<string, { u: string | null; a: boolean; i: string | null }>;
function saveIdentities(name: string, raw: any): Identities {
  const out: Identities = {};
  for (const [k, v] of Object.entries<any>(raw?.versions ?? {})) out[k] = { u: typeof v?._npmUser?.name === "string" && !sharedPublisher(v._npmUser) ? v._npmUser.name : null, a: !!v?.dist?.attestations, i: typeof v?.dist?.integrity === "string" ? v.dist.integrity : null };
  const file = join(cacheDir!, "identity", `${encodeURIComponent(name)}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(out)); renameSync(`${file}.tmp`, file);
  return out;
}
const idMemo = new Map<string, Promise<Identities | "error">>();
function identities(name: string): Promise<Identities | "error"> {
  if (!idMemo.has(name)) idMemo.set(name, (async () => {
    const file = join(cacheDir!, "identity", `${encodeURIComponent(name)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    try { const raw = await getJson(`https://registry.npmjs.org/${registryPath(name)}`); return raw ? saveIdentities(name, raw) : "error"; } catch (error) { console.error(String(error)); return "error"; }
  })());
  return idMemo.get(name)!;
}
const provMemo = new Map<string, Promise<ReleaseIdentity["provenance"] | "error">>();
function provenance(name: string, version: string, integrity: string | null): Promise<ReleaseIdentity["provenance"] | "error"> {
  const key = `${name}@${version}`;
  if (!provMemo.has(key)) provMemo.set(key, (async () => {
    const file = join(cacheDir!, "attest", `${encodeURIComponent(key)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).p;
    try {
      const raw = await getJson(`https://registry.npmjs.org/-/npm/v1/attestations/${registryPath(name)}@${encodeURIComponent(version)}`);
      if (!raw) return "error";
      const out = provenanceFrom(raw, { name, version, integrity });
      writeFileSync(file, JSON.stringify({ p: out }));
      return out;
    } catch (error) { console.error(`${key}: ${String(error)}`); return "error"; }
  })());
  return provMemo.get(key)!;
}
async function identityOf(name: string, version: string, d: Doc): Promise<ReleaseIdentity | "removed" | "error"> {
  if (!d.versions[version]) return "removed";
  const ids = await identities(name);
  if (ids === "error" || !ids[version]) return "error";
  const prov = ids[version]!.a ? await provenance(name, version, ids[version]!.i) : null;
  if (prov === "error") return "error";
  return { publisher: ids[version]!.u, provenance: prov };
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
type Fix = { name: string; version: string; t: number };
type Allowed = { version: string; published: string; basis: SameRelease["basis"] };
type Tree = { unsatisfiable: string[]; unknown: string[]; allowed: Allowed[]; newest: number; nodes: number };
/** The exception for one candidate published at or after T, as in malicious-v4.ts. */
async function exception(fix: Fix, own: ReleaseIdentity, name: string, version: string, at: number, d: Doc): Promise<SameRelease["basis"] | "no" | "unverified" | "unreadable"> {
  if (!own.provenance && (!own.publisher || version !== fix.version || at - fix.t > SAME_RELEASE_MINUTES * 60_000)) return "no";
  if (own.provenance && (!own.provenance.repository || !own.provenance.workflow || !own.provenance.commit)) return "no";
  const other = await identityOf(name, version, d);
  if (other === "removed") return "unverified";
  if (other === "error") return "unreadable";
  return sameRelease({ version: fix.version, published: fix.t, identity: own }, { version, published: at, identity: other }, fix.t) ?? "no";
}
/**
 * Rule 1 on a fresh resolution of A@x: requirements no allowed version satisfies, branches not readable, and the
 * versions the exception allowed. `own` is A@x's publisher and provenance; null resolves without the exception.
 */
async function rule1(fix: Fix, own: ReleaseIdentity | null): Promise<Tree> {
  const out: Tree = { unsatisfiable: [], unknown: [], allowed: [], newest: fix.t, nodes: 0 };
  const seen = new Set<string>();
  let frontier = [{ name: fix.name, version: fix.version }];
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
      let chosen = highestBefore(d, n.range, fix.t);
      if (own) {
        const later = Object.keys(d.time).map(v => ({ v, at: Date.parse(d.time[v] ?? "") })).filter(c => c.at >= fix.t && c.at < fix.t + HORIZON && semver.satisfies(c.v, n.range) && (!chosen || semver.gt(c.v, chosen))).sort((a, b) => semver.rcompare(a.v, b.v));
        for (const c of later) {
          const basis = await exception(fix, own, n.name, c.v, c.at, d);
          if (basis === "provenance" || basis === "publisher") {
            chosen = c.v;
            if (!out.allowed.some(a => a.version === `${n.name}@${c.v}`)) out.allowed.push({ version: `${n.name}@${c.v}`, published: d.time[c.v]!, basis });
            out.newest = Math.max(out.newest, c.at);
            break;
          }
          if (basis !== "no") out.unknown.push(`${n.name}@${c.v}: the same-release check is ${basis}`);
        }
      }
      if (!chosen) { out.unsatisfiable.push(`${n.name}@${n.range}`); continue; }
      if (!seen.has(`${n.name}@${chosen}`)) frontier.push({ name: n.name, version: chosen });
    }
  }
  if (out.nodes > 20_000) out.unknown.push("tree larger than 20,000 versions");
  return out;
}

/** The signal a judge stop message belongs to. */
function signalOf(message: string): string {
  const signals: [RegExp, string][] = [
    [/^Time cap: no version of .* was published before the fix/, "rule 1 (tree)"],
    [/^New dependency /, "rule 2"],
    [/is deprecated/, "deprecation"],
    [/malicious-package records/, "MAL- record"],
    [/no longer listed/, "withdrawn"],
    [/had build provenance|was built from/, "provenance"],
    [/install scripts/, "install scripts"],
    [/has known advisories/, "gate 1: new advisories"],
    [/ goes down from /, "gate 1: downgrade"],
    [/^Time cap:/, "time cap undecidable"],
    [/^A lookup failed|^No registry facts|has no publish time/, "facts unreadable"],
  ];
  return signals.find(([pattern]) => pattern.test(message))?.[1] ?? "other";
}

type Judged = { verdict: string; stops: string[]; signals: string[]; added_delay_hours: number | null; newest: string; rule1_unsatisfiable: string[]; rule1_unknown: number; allowed: Allowed[]; tree_versions: number };
type Row = { id: string; name: string; from: string; to: string; fix_published: string; advisory_published: string; urgency: string; wait_hours: number; rule2_young: string[]; publisher: string | null; provenance: ReleaseIdentity["provenance"]; with_exception: Judged; without_exception: Judged };
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
  const own = releaseIdentity(gathered.facts.get(`${c.name}@${c.fixed}`)!);
  const fix = { name: c.name, version: c.fixed, t: Date.parse(published) };
  const judged = (tree: Tree): Judged => {
    const stops = [
      ...result.findings.filter(f => f.effect === "stop" && f.gate !== 4).map(f => f.message),
      ...tree.unsatisfiable.map(r => `Time cap: no version of ${r} was published before the fix (T = ${published}) or is the same release.`),
    ];
    return {
      verdict: stops.length ? "stop" : "ready_except_build", stops, signals: [...new Set(stops.map(signalOf))].sort(),
      added_delay_hours: stops.length ? null : Math.max(0, Math.round((tree.newest + result.wait_hours * H - Date.parse(c.advisoryPublished)) / 360_000) / 10),
      newest: new Date(tree.newest).toISOString(), rule1_unsatisfiable: tree.unsatisfiable, rule1_unknown: tree.unknown.length, allowed: tree.allowed, tree_versions: tree.nodes,
    };
  };
  rows.push({
    id: c.id, name: c.name, from, to: c.fixed, fix_published: published, advisory_published: c.advisoryPublished,
    urgency: result.urgency, wait_hours: result.wait_hours, rule2_young: result.time_cap.young, publisher: own.publisher, provenance: own.provenance,
    with_exception: judged(await rule1(fix, own)), without_exception: judged(await rule1(fix, null)),
  });
  if (rows.length % 20 === 0) console.log(`${rows.length}/${SAMPLE}`);
}

const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const URG = ["exploited", "high", "normal", "low"];
type Mode = "with_exception" | "without_exception";
const summary = (mode: Mode) => {
  const signals = [...new Set(rows.flatMap(r => r[mode].signals))].sort();
  return {
    stopped: count(r => r[mode].verdict === "stop"),
    stops_by_signal: Object.fromEntries(signals.map(s => [s, { fires: count(r => r[mode].signals.includes(s)), alone: count(r => r[mode].signals.length === 1 && r[mode].signals[0] === s) }])),
    rule1_trees_with_unknown_branch: count(r => r[mode].rule1_unknown > 0),
    added_delay_by_urgency: Object.fromEntries(URG.map(u => {
      const d = rows.filter(r => r.urgency === u && r[mode].added_delay_hours !== null).map(r => r[mode].added_delay_hours!).sort((a, b) => a - b);
      return [u, { n: d.length, median: d[Math.floor(d.length / 2)] ?? null, p90: d[Math.floor(d.length * 0.9)] ?? null, stopped: count(r => r.urgency === u && r[mode].verdict === "stop") }];
    })),
  };
};
const gates = (mode: Mode) => {
  const median = (u: string) => summary(mode).added_delay_by_urgency[u]!.median;
  const within = (u: string, hours: number) => { const m = median(u); return m === null ? "not measured" : m <= hours ? "met" : "not met"; };
  return { exploited_median_within_24h: within("exploited", 24), high_median_within_24h: within("high", 24), normal_median_within_72h: within("normal", 72) };
};
const allowedIn = rows.filter(r => r.with_exception.allowed.length > 0);
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/src/fixes-v4.ts and docs/decisions.md, \"Rule 1's same-release exception, and backtest v4's definitions\".",
  candidates: candidates.length, sample: rows.length, skipped,
  by_urgency: Object.fromEntries(URG.map(u => [u, count(r => r.urgency === u)])),
  with_exception: { ...summary("with_exception"), gates: gates("with_exception") },
  without_exception: { ...summary("without_exception"), gates: gates("without_exception") },
  exception: {
    updates_where_it_allowed_a_version: allowedIn.length,
    allowed_versions: { provenance: count(r => r.with_exception.allowed.some(a => a.basis === "provenance")), publisher: count(r => r.with_exception.allowed.some(a => a.basis === "publisher")) },
    of_those_rule1_stops_without_it: count(r => r.with_exception.allowed.length > 0 && r.without_exception.rule1_unsatisfiable.length > 0),
    rule1_stops_without_it: count(r => r.without_exception.rule1_unsatisfiable.length > 0),
    rule1_stops_with_it: count(r => r.with_exception.rule1_unsatisfiable.length > 0),
    stopped_without_it_ready_with_it: rows.filter(r => r.without_exception.verdict === "stop" && r.with_exception.verdict !== "stop").map(r => `${r.name}@${r.to}`),
    still_stopped_by_rule1: rows.filter(r => r.with_exception.rule1_unsatisfiable.length > 0).map(r => ({ update: `${r.name}@${r.to}`, unsatisfiable: r.with_exception.rule1_unsatisfiable, provenance: r.provenance ? "yes" : "no" })),
  },
  advisory_before_fix: count(r => Date.parse(r.advisory_published) < Date.parse(r.fix_published)),
  caveats: [
    "Deprecation, provenance and publisher are today's registry facts, not those of the time; a later deprecation counts as a stop.",
    "Urgency uses today's CISA KEV list and today's EPSS score.",
    "Rule 1 resolves the fix's tree with no lockfile: an upper bound on its stops, since a real lockfile can already hold a later version.",
    "The exception is looked for among versions published before T + 24h; the product's provenance branch has no time limit.",
    "Gate 3 (build and test) is not part of the delay.",
  ],
  rows,
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify(shown, null, 2));
