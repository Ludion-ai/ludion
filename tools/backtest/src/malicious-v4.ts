// Backtest v4, malicious releases (docs/decisions.md, "Rule 1's same-release exception, and backtest v4's definitions").
// Backtest v3 (malicious-v3.ts) with rule 1's same-release exception: each requirement in A@x's production tree resolves
// to the highest version rule 1 allows, either published before T or published in [T, T + 24h) and the same release as
// A@x (time-cap.ts, sameRelease). The change is judged at its newest publish + w. Every tree is resolved twice, with the
// exception (primary) and without it (v3's rule), on the same data.
//
// Usage: node tools/backtest/src/malicious-v4.ts <osv-npm-dir> <malicious-v2.json> <cache-dir> <out.json> [--plan|--limit=N]
// Reads untrusted JSON only; runs nothing from it. Network: registry.npmjs.org and api.deps.dev, read-only, cached.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { EXPLOITED_UNCOMPARABLE_HOURS, EXTENDED_MIN_HOURS, installScripts, WAIT_HOURS, type Urgency } from "../../../packages/cli/src/security/judge.ts";
import { provenanceFrom, sharedPublisher } from "../../../packages/cli/src/security/npm-facts.ts";
import { firstPublish, SAME_RELEASE_MINUTES, sameRelease, type ReleaseIdentity, type SameRelease } from "../../../packages/cli/src/security/time-cap.ts";

const [osvDir, v2File, cacheDir, outFile, flag] = process.argv.slice(2);
if (!osvDir || !v2File || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/malicious-v4.ts <osv-npm-dir> <malicious-v2.json> <cache-dir> <out.json> [--plan|--limit=N]");
for (const dir of ["registry", "depsdev", "identity", "attest"]) mkdirSync(join(cacheDir, dir), { recursive: true });

type V2Row = { id: string; name: string; version: string; published: string; previous: string; present: boolean; previous_present: boolean; hours_to_mal: number; hours_to_mal_conservative: number; provenance_regression: boolean; install_scripts_added: boolean; extends: string[]; comparable: boolean };
const rows: V2Row[] = JSON.parse(readFileSync(v2File, "utf8")).rows;
const watched = new Set(rows.map(r => r.name));
const malicious = new Set(rows.map(r => `${r.name}@${r.version}`));

// --- Registry documents, compacted as in malicious-v3.ts (same cache format). ---
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
/** null: the registry does not serve the package (404); "error": it could not be read. */
function doc(name: string): Promise<Doc | null | "error"> {
  if (!memo.has(name)) memo.set(name, (async () => {
    if (!NAME.test(name)) return "error";
    const file = join(cacheDir!, "registry", `${encodeURIComponent(name)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    let raw: any;
    try { raw = await getJson(`https://registry.npmjs.org/${registryPath(name)}`); } catch (error) { console.error(String(error)); return "error"; }
    const out: Doc | null = raw && { created: firstPublish(raw.time ?? {}), time: {}, versions: {} };
    if (raw) {
      for (const [k, v] of Object.entries(raw.time ?? {})) if (typeof v === "string" && semver.valid(k)) out!.time[k] = v;
      for (const [k, v] of Object.entries<any>(raw.versions ?? {})) {
        const pick = (o: unknown) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length ? Object.fromEntries(Object.entries(o).filter(([, s]) => typeof s === "string")) as Req : undefined;
        const optionalPeers = Object.entries<any>(v?.peerDependenciesMeta ?? {}).filter(([, m]) => m?.optional).map(([n]) => n);
        const bundled = Array.isArray(v?.bundleDependencies) ? v.bundleDependencies : Array.isArray(v?.bundledDependencies) ? v.bundledDependencies : undefined;
        out!.versions[k] = { d: pick(v?.dependencies), o: pick(v?.optionalDependencies), p: pick(v?.peerDependencies), ...(optionalPeers.length ? { po: optionalPeers } : {}), ...(bundled?.length ? { b: bundled.filter((x: unknown) => typeof x === "string") } : {}), ...(installScripts(v?.scripts).length ? { s: true } : {}) };
      }
      saveIdentities(name, raw);
    }
    writeFileSync(`${file}.tmp`, JSON.stringify(out)); renameSync(`${file}.tmp`, file);
    return out;
  })());
  return memo.get(name)!;
}
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]!); } }));
  return out;
}

// --- Publisher and provenance, for the same-release exception (read from the registry on the run date). ---
/**
 * Per listed version: the publisher's account (`_npmUser` name; null for trusted publishing's shared user), whether it
 * has an attestation record, and its integrity (the provenance statement must name that tarball).
 */
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
/** "removed": the registry no longer lists the version, so neither fact can be read. */
async function identityOf(name: string, version: string, d: Doc): Promise<ReleaseIdentity | "removed" | "error"> {
  if (!d.versions[version]) return "removed";
  const ids = await identities(name);
  if (ids === "error" || !ids[version]) return "error";
  const prov = ids[version]!.a ? await provenance(name, version, ids[version]!.i) : null;
  if (prov === "error") return "error";
  return { publisher: ids[version]!.u, provenance: prov };
}

// --- Fixes: every non-prerelease npm fixed event of non-withdrawn GHSA- records. ---
type Fix = { id: string; name: string; version: string; t: number; advisory: string };
const fixEvents = new Map<string, { id: string; name: string; version: string; advisory: string }>();
for (const file of readdirSync(osvDir)) {
  if (!file.startsWith("GHSA-")) continue;
  const record = JSON.parse(readFileSync(join(osvDir, file), "utf8"));
  if (record.withdrawn) continue;
  for (const affected of record.affected ?? []) {
    if (affected?.package?.ecosystem !== "npm" || typeof affected.package.name !== "string") continue;
    for (const range of affected.ranges ?? []) for (const event of range.events ?? []) {
      if (typeof event.fixed !== "string" || !semver.valid(event.fixed) || semver.prerelease(event.fixed)) continue;
      const key = `${affected.package.name}@${semver.valid(event.fixed)}`;
      if (!fixEvents.has(key)) fixEvents.set(key, { id: record.id, name: affected.package.name, version: semver.valid(event.fixed)!, advisory: record.published });
    }
  }
}
const fixNames = [...new Set([...fixEvents.values()].map(f => f.name))];
console.log(`${fixEvents.size} npm fixed versions in GHSA records, ${fixNames.length} packages`);
let fetched = 0;
await pool(fixNames, 16, async name => { await doc(name); if (++fetched % 500 === 0) console.log(`fix packages ${fetched}/${fixNames.length}`); });
const fixes: Fix[] = [];
const fixesLeftOut = { not_served: 0, unreadable: 0, no_publish_time: 0 };
for (const f of fixEvents.values()) {
  const d = await doc(f.name);
  if (d === null) { fixesLeftOut.not_served++; continue; }
  if (d === "error") { fixesLeftOut.unreadable++; continue; }
  const at = Date.parse(d.time[f.version] ?? "");
  if (!d.versions[f.version] || !Number.isFinite(at)) { fixesLeftOut.no_publish_time++; continue; }
  fixes.push({ ...f, t: at });
}
fixes.sort((a, b) => a.t - b.t);

// --- Each malicious version: record times and the judge's waits. ---
const H = 3_600_000;
/** How far after T the backtest looks for versions the exception allows (decisions: it bounds the same-commit search). */
const HORIZON = 24 * H;
type Scenario = "a" | "b";
const URGENCIES = Object.keys(WAIT_HOURS) as Urgency[];
for (const r of rows) await doc(r.name);
const record = (r: V2Row, timing: "conservative" | "optimistic") => Date.parse(r.published) + (timing === "conservative" ? r.hours_to_mal_conservative : r.hours_to_mal) * H;

// deps.dev for removed versions: provenance and declared requirements.
type DepsDev = { found: boolean; provenance: boolean | null; requires: string[] | null };
async function depsDev(name: string, version: string): Promise<DepsDev> {
  const file = join(cacheDir!, "depsdev", `${encodeURIComponent(`${name}@${version}`)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const base = `https://api.deps.dev/v3/systems/npm/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;
  let out: DepsDev = { found: false, provenance: null, requires: null };
  try {
    const v = await getJson(base);
    if (v) {
      const req = await getJson(`${base}:requirements`);
      const npm = req?.npm?.dependencies;
      out = { found: true, provenance: (Array.isArray(v.slsaProvenances) && v.slsaProvenances.length > 0) || (Array.isArray(v.attestations) && v.attestations.length > 0),
        requires: npm ? [...new Set([...(npm.dependencies ?? []), ...(npm.optionalDependencies ?? [])].map((x: any) => x?.name).filter((x: unknown): x is string => typeof x === "string"))].sort() : null };
    }
  } catch (error) { console.error(String(error)); return out; }
  writeFileSync(file, JSON.stringify(out));
  return out;
}
type Facts = {
  provenance: { regression: boolean; source: "registry" | "deps.dev" | "unverified" };
  newDeps: { added: boolean; source: "registry" | "deps.dev" | "unverified" };
  scripts: { added: boolean; source: "registry" | "unverified" };
  publisher: { changed: boolean; source: "registry" | "unverified" };
};
const cached = new Map<string, Doc>();
for (const name of watched) { const d = await doc(name); if (d && d !== "error") cached.set(name, d); }
const facts = new Map<string, Facts>();
let dd = 0;
await pool(rows, 8, async r => {
  const id = `${r.name}@${r.version}`;
  const both = r.present && r.previous_present;
  let provenance: Facts["provenance"] = both ? { regression: r.provenance_regression, source: "registry" } : { regression: false, source: "unverified" };
  let newDeps: Facts["newDeps"] = both ? { added: r.extends.includes("new dependencies"), source: "registry" } : { added: false, source: "unverified" };
  if (!both) {
    const [v, p] = await Promise.all([depsDev(r.name, r.version), depsDev(r.name, r.previous)]);
    if (v.found && p.found && v.provenance !== null && p.provenance !== null) provenance = { regression: p.provenance && !v.provenance, source: "deps.dev" };
    if (v.found && p.found && v.requires && p.requires) newDeps = { added: v.requires.some(x => !p.requires!.includes(x)), source: "deps.dev" };
  }
  facts.set(id, {
    provenance, newDeps,
    scripts: both ? { added: r.install_scripts_added, source: "registry" } : { added: false, source: "unverified" },
    publisher: both ? { changed: r.extends.includes("publisher changed"), source: "registry" } : { changed: false, source: "unverified" },
  });
  if (++dd % 200 === 0) console.log(`facts ${dd}/${rows.length}`);
});

/** The judge's wait for the change carrying P@V, by scenario. */
function wait(r: V2Row, u: Urgency, s: Scenario): number {
  let w = WAIT_HOURS[u];
  if (u === "exploited" && (s === "a" || !r.comparable)) w = EXPLOITED_UNCOMPARABLE_HOURS;
  const f = facts.get(`${r.name}@${r.version}`)!;
  // (a): P is new to the project. (b): publisher change, new dependencies, or prev no longer listed.
  const extended = s === "a" || f.publisher.changed || f.newDeps.added || !r.previous_present;
  return extended ? Math.max(w * 2, EXTENDED_MIN_HOURS) : w;
}
/** Stops by gate 2 signals other than the re-query (they do not depend on the wait). */
function otherStop(r: V2Row, s: Scenario): string[] {
  const f = facts.get(`${r.name}@${r.version}`)!, out: string[] = [];
  if (s === "b" && f.provenance.regression) out.push(`provenance (${f.provenance.source})`);
  if (s === "b" && f.scripts.added) out.push("install scripts added (registry)");
  // (a) has no predecessor: a new package that runs install scripts stops; readable only while the registry lists V.
  if (s === "a" && r.present && cached.get(r.name)?.versions[r.version]?.s) out.push("install scripts on a new package (registry)");
  return out;
}

// Which fixes can matter: T in (p - 24h, record - smallest wait) for some V. A fix published before V can select V only
// through the exception, which looks at most 24h after T.
const minWait = (r: V2Row) => Math.min(...URGENCIES.flatMap(u => (["a", "b"] as const).map(s => wait(r, u, s))));
const windows = rows.map(r => ({ r, from: Date.parse(r.published) - HORIZON, to: record(r, "conservative") - minWait(r) * H }));
const inWindow = fixes.filter(f => windows.some(w => f.t > w.from && f.t < w.to));
const afterAny = fixes.filter(f => rows.some(r => f.t > Date.parse(r.published) - HORIZON));
console.log(`fixes with a registry time: ${fixes.length}; in some V's window: ${inWindow.length}; published after some V - 24h: ${afterAny.length}`);
if (flag === "--plan") process.exit(0);

// --- Ludion's resolution of A@x, with and without the exception. ---
/**
 * For each (package, range): the satisfying versions in publish order, with the running highest, so "the highest
 * published before t" is a binary search, and the versions published in [t, t + 24h) are a slice.
 */
const ladders = new Map<string, { times: number[]; versions: string[]; best: string[] }>();
function ladder(name: string, d: Doc, range: string) {
  const key = `${name}\0${range}`;
  let l = ladders.get(key);
  if (!l) {
    // Every version published, including those the registry has since removed: they could be installed at the time.
    const satisfying = Object.keys(d.time).filter(v => Number.isFinite(Date.parse(d.time[v] ?? "")) && semver.satisfies(v, range)).map(v => ({ v, t: Date.parse(d.time[v]!) })).sort((a, b) => a.t - b.t);
    l = { times: [], versions: [], best: [] };
    for (const { v, t: at } of satisfying) { const top = l.best.at(-1); l.times.push(at); l.versions.push(v); l.best.push(top && semver.gt(top, v) ? top : v); }
    ladders.set(key, l);
  }
  return l;
}
const firstAtOrAfter = (times: number[], t: number) => { let lo = 0, hi = times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid]! < t) lo = mid + 1; else hi = mid; } return lo; };
function highestBefore(name: string, d: Doc, range: string, t: number): string | null {
  const l = ladder(name, d, range), i = firstAtOrAfter(l.times, t);
  return i ? l.best[i - 1]! : null;
}
function parseSpec(name: string, spec: string): { name: string; range: string } | "skip" | null {
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.*))?$/.exec(spec);
  if (alias) return { name: alias[1]!, range: alias[2] || "*" };
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:)|^[^@\s]+\/[^@\s]+(?:#.*)?$/.test(spec)) return "skip";
  if (spec === "" || spec === "latest") return { name, range: "*" };
  return semver.validRange(spec) ? { name, range: spec } : null;
}

type FixIdentity = ReleaseIdentity | "error";
const fixIds = new Map<string, Promise<FixIdentity>>();
function fixIdentity(fix: Fix): Promise<FixIdentity> {
  const key = `${fix.name}@${fix.version}`;
  if (!fixIds.has(key)) fixIds.set(key, (async () => {
    const d = await doc(fix.name);
    if (!d || d === "error") return "error";
    const id = await identityOf(fix.name, fix.version, d);
    return id === "removed" ? "error" : id;
  })());
  return fixIds.get(key)!;
}
/** The exception for one candidate published at or after T: allowed (with its basis), not allowed, or unverified. */
async function exception(fix: Fix, own: FixIdentity, name: string, version: string, at: number, d: Doc): Promise<SameRelease["basis"] | "no" | "unverified" | "unreadable"> {
  if (own === "error") return "unreadable";
  // Without provenance on the fix, only the publisher branch is left: the same version, at most 15 minutes after T.
  if (!own.provenance && (!own.publisher || version !== fix.version || at - fix.t > SAME_RELEASE_MINUTES * 60_000)) return "no";
  // Provenance naming no repository, workflow or commit can match nothing.
  if (own.provenance && (!own.provenance.repository || !own.provenance.workflow || !own.provenance.commit)) return "no";
  const other = await identityOf(name, version, d);
  if (other === "removed") return "unverified";
  if (other === "error") return "unreadable";
  return sameRelease({ version: fix.version, published: fix.t, identity: own }, { version, published: at, identity: other }, fix.t) ?? "no";
}

type Allowed = { version: string; published: string; basis: SameRelease["basis"] };
type Resolution = { range: string; chosen: string | null; unverified: string[] };
type Tree = { stoppedByRule1: string[]; unknown: string[]; unverified: string[]; allowed: Allowed[]; watched: Map<string, Resolution[]>; nodes: number; newest: number };
/** One requirement: the highest version rule 1 allows (before T, or the same release as A@x within the horizon). */
async function resolveRange(fix: Fix, own: FixIdentity | null, name: string, d: Doc, range: string, tree: Tree): Promise<Resolution> {
  const before = highestBefore(name, d, range, fix.t);
  const out: Resolution = { range, chosen: before, unverified: [] };
  if (!own) return out;
  const l = ladder(name, d, range);
  const from = firstAtOrAfter(l.times, fix.t), to = firstAtOrAfter(l.times, fix.t + HORIZON);
  const candidates = l.versions.slice(from, to).map((v, i) => ({ v, at: l.times[from + i]! })).filter(c => !before || semver.gt(c.v, before)).sort((a, b) => semver.rcompare(a.v, b.v));
  for (const c of candidates) {
    const basis = await exception(fix, own, name, c.v, c.at, d);
    if (basis === "provenance" || basis === "publisher") {
      out.chosen = c.v;
      if (!tree.allowed.some(a => a.version === `${name}@${c.v}`)) tree.allowed.push({ version: `${name}@${c.v}`, published: d.time[c.v]!, basis });
      tree.newest = Math.max(tree.newest, c.at);
      return out;
    }
    if (basis === "no") continue;
    // Unverified or unreadable: never allowed. A malicious V is recorded for its selection; anything else is an unknown branch.
    out.unverified.push(c.v);
    tree.unverified.push(`${name}@${c.v} (${basis})`);
    if (!malicious.has(`${name}@${c.v}`)) tree.unknown.push(`${name}@${c.v}: the same-release check is ${basis}`);
  }
  return out;
}
async function resolveTree(fix: Fix, withException: boolean): Promise<Tree> {
  const tree: Tree = { stoppedByRule1: [], unknown: [], unverified: [], allowed: [], watched: new Map(), nodes: 0, newest: fix.t };
  const own = withException ? await fixIdentity(fix) : null;
  const seen = new Set<string>();
  let frontier: { name: string; version: string }[] = [{ name: fix.name, version: fix.version }];
  while (frontier.length) {
    await pool([...new Set(frontier.map(n => n.name))], 16, name => doc(name));
    const next: { name: string; range: string }[] = [], queued = new Set<string>();
    for (const node of frontier) {
      const key = `${node.name}@${node.version}`;
      if (seen.has(key)) continue;
      seen.add(key); tree.nodes++;
      const d = await doc(node.name);
      if (d === null || d === "error" || !d.versions[node.version]) { tree.unknown.push(key); continue; }
      const m = d.versions[node.version]!;
      const reqs: Req = { ...m.p, ...m.o, ...m.d };
      for (const optional of m.po ?? []) if (!m.d?.[optional] && !m.o?.[optional]) delete reqs[optional];
      for (const b of m.b ?? []) delete reqs[b];
      for (const [depName, spec] of Object.entries(reqs)) {
        const parsed = parseSpec(depName, spec);
        if (parsed === "skip") continue;
        if (!parsed) { tree.unknown.push(`${key} -> ${depName}@${spec}`); continue; }
        if (!queued.has(`${parsed.name}\0${parsed.range}`)) { queued.add(`${parsed.name}\0${parsed.range}`); next.push(parsed); }
      }
    }
    // Resolve the next level's ranges.
    frontier = [];
    await pool([...new Set(next.map(n => n.name))], 16, name => doc(name));
    for (const n of next) {
      const d = await doc(n.name);
      if (d === null || d === "error") { tree.unknown.push(`${n.name}@${n.range}`); continue; }
      const res = await resolveRange(fix, own, n.name, d, n.range, tree);
      if (watched.has(n.name)) tree.watched.set(n.name, [...(tree.watched.get(n.name) ?? []), res]);
      if (!res.chosen) { tree.stoppedByRule1.push(`${n.name}@${n.range}`); continue; }
      if (!seen.has(`${n.name}@${res.chosen}`)) frontier.push({ name: n.name, version: res.chosen });
    }
    if (tree.nodes > 20_000) { tree.unknown.push("tree larger than 20,000 versions"); break; }
  }
  return tree;
}

/** Does a fix's tree select V, per scenario? "unknown": only through a candidate whose same-release check is unverified. */
function selection(tree: Tree, r: V2Row, s: Scenario): "yes" | "unknown" | "no" {
  let unknown = false;
  for (const res of tree.watched.get(r.name) ?? []) {
    if (s === "b" && semver.satisfies(r.previous, res.range)) continue;
    if (res.chosen === r.version) return "yes";
    if (res.unverified.includes(r.version)) unknown = true;
  }
  return unknown ? "unknown" : "no";
}

type Mode = "with" | "without";
type Resolved = { stopped: boolean; unknown: boolean; newest: number; tree: Tree };
type FixResult = { fix: Fix; with: Resolved; without: Resolved };
const results: FixResult[] = [];
let resolved = 0;
const started = Date.now();
// --limit=N resolves only the last N (a smoke test of the script; its output is not a result).
const toResolve = flag?.startsWith("--limit=") ? afterAny.slice(-Number(flag.slice(8))) : afterAny;
const pack = (tree: Tree): Resolved => ({ stopped: tree.stoppedByRule1.length > 0, unknown: tree.unknown.length > 0, newest: tree.newest, tree });
await pool(toResolve, 6, async fix => {
  const without = await resolveTree(fix, false), withEx = await resolveTree(fix, true);
  results.push({ fix, with: pack(withEx), without: pack(without) });
  if (++resolved % 100 === 0) console.log(`trees ${resolved}/${toResolve.length} (${Math.round((Date.now() - started) / 60000)} min, ${memo.size} packages, ${provMemo.size} attestations)`);
});
results.sort((a, b) => a.fix.t - b.fix.t);

// --- Outcomes, with and without the exception. ---
type Outcome = "stopped" | "missed" | "unknown";
const TIMINGS = ["conservative", "optimistic"] as const;
type Timing = typeof TIMINGS[number];
const fixId = (x: FixResult) => `${x.fix.name}@${x.fix.version}`;
const out = rows.map(r => {
  const p = Date.parse(r.published);
  const near = results.filter(x => x.fix.t > p - HORIZON && x.fix.name !== r.name);
  // Rule 2 on P: its first publish later than T minus the base wait (computed; see rule2_note).
  const created = Date.parse(cached.get(r.name)?.created ?? "");
  const young = (t: number, u: Urgency) => !Number.isFinite(created) || created > t - WAIT_HOURS[u] * H;
  const per = (mode: Mode) => {
    const live = near.filter(x => !x[mode].stopped);
    const sel = (s: Scenario, kind: "yes" | "unknown") => live.filter(x => selection(x[mode].tree, r, s) === kind);
    const selectedBy = { a: sel("a", "yes"), b: sel("b", "yes") }, unverifiedBy = { a: sel("a", "unknown"), b: sel("b", "unknown") };
    const stoppedByRule1 = { a: near.filter(x => x[mode].stopped && selection(x[mode].tree, r, "a") === "yes").length, b: near.filter(x => x[mode].stopped && selection(x[mode].tree, r, "b") === "yes").length };
    const outcome = (u: Urgency, s: Scenario, timing: Timing): Outcome => {
      const w = wait(r, u, s) * H, end = record(r, timing);
      if (otherStop(r, s).length) return "stopped";
      if (selectedBy[s].some(x => x[mode].newest + w < end && !young(x.fix.t, u))) return "missed";
      if (unverifiedBy[s].some(x => x[mode].newest + w < end && !young(x.fix.t, u))) return "unknown";
      if (live.some(x => x.fix.t > p && x[mode].newest + w < end && x[mode].unknown)) return "unknown";
      return "stopped";
    };
    const outcomes = Object.fromEntries(URGENCIES.map(u => [u, Object.fromEntries(TIMINGS.map(timing => {
      const a = outcome(u, "a", timing), b = outcome(u, "b", timing);
      return [timing, { a, b, primary: a === "missed" || b === "missed" ? "missed" : a === "unknown" || b === "unknown" ? "unknown" : "stopped" }];
    }))])) as Record<Urgency, Record<Timing, Record<"a" | "b" | "primary", Outcome>>>;
    // Why a stopped V is stopped, per urgency (conservative timing): another gate 2 signal, the re-query (every
    // selection's wait ends after the record), or no fix that rule 1 lets through selects it.
    const reasons = Object.fromEntries(URGENCIES.map(u => {
      const w = (s: Scenario) => wait(r, u, s) * H, end = record(r, "conservative");
      const requery = (["a", "b"] as const).some(s => [...selectedBy[s], ...unverifiedBy[s]].some(x => x[mode].newest + w(s) >= end));
      const selected = (["a", "b"] as const).some(s => selectedBy[s].length + unverifiedBy[s].length > 0);
      const onlyRule1 = !selected && stoppedByRule1.a + stoppedByRule1.b > 0;
      return [u, { other: [...new Set([...otherStop(r, "a"), ...otherStop(r, "b")])], requery, not_selected: !selected, only_rule1_trees: onlyRule1 }];
    })) as Record<Urgency, { other: string[]; requery: boolean; not_selected: boolean; only_rule1_trees: boolean }>;
    const describe = (x: FixResult) => {
      const ex = x[mode].tree.allowed.find(a => a.version === `${r.name}@${r.version}`);
      return { fix: fixId(x), advisory: x.fix.id, t: new Date(x.fix.t).toISOString(), hours_after_v: Math.round((x.fix.t - p) / H * 10) / 10, v_before_t: p < x.fix.t, ...(ex ? { allowed_as: ex.basis } : {}), judged_at: new Date(x[mode].newest).toISOString() };
    };
    const all = (s: Scenario) => selectedBy[s].map(describe);
    // Diagnostic only (added after the first execution; it changes no outcome): for an unknown V, the fixes whose
    // unreadable branch makes it unknown, and whether rule 1 stopped each of them without the exception.
    const unknownBecause = Object.fromEntries(URGENCIES.filter(u => outcomes[u].conservative.primary === "unknown").map(u => {
      const causes = new Map<string, { fix: string; t: string; stopped_without_exception: boolean; unknown_without_exception: boolean }>();
      for (const s of ["a", "b"] as const) for (const x of live) {
        if (x.fix.t > p && x[mode].newest + wait(r, u, s) * H < record(r, "conservative") && x[mode].unknown) causes.set(fixId(x), { fix: fixId(x), t: new Date(x.fix.t).toISOString(), stopped_without_exception: x.without.stopped, unknown_without_exception: x.without.unknown });
      }
      const list = [...causes.values()];
      return [u, { fixes: list.length, stopped_by_rule1_without_exception: list.filter(c => c.stopped_without_exception).length, first: list.slice(0, 3), from_unverified_selection: unverifiedBy.a.length + unverifiedBy.b.length > 0 }];
    }));
    return { outcomes, reasons, selecting: { a: all("a"), b: all("b") }, unverified: { a: unverifiedBy.a.map(describe), b: unverifiedBy.b.map(describe) }, selections_in_rule1_stopped_trees: stoppedByRule1, unknown_because: unknownBecause };
  };
  const f = facts.get(`${r.name}@${r.version}`)!;
  return {
    id: r.id, name: r.name, version: r.version, published: r.published, previous: r.previous, present: r.present,
    record_hours: { conservative: r.hours_to_mal_conservative, optimistic: r.hours_to_mal },
    facts: f, other_stops: { a: otherStop(r, "a"), b: otherStop(r, "b") },
    with_exception: per("with"), without_exception: per("without"),
  };
});

type Row = typeof out[number];
const count = (mode: "with_exception" | "without_exception", u: Urgency, timing: Timing, key: "a" | "b" | "primary", o: Outcome) => out.filter(x => x[mode].outcomes[u][timing][key] === o).length;
const byUrgency = (mode: "with_exception" | "without_exception") => Object.fromEntries(URGENCIES.map(u => [u, Object.fromEntries(TIMINGS.map(timing => [timing, Object.fromEntries((["primary", "a", "b"] as const).map(k => [k, { stopped: count(mode, u, timing, k, "stopped"), missed: count(mode, u, timing, k, "missed"), unknown: count(mode, u, timing, k, "unknown") }]))]))]));
const stopsBySignal = (mode: "with_exception" | "without_exception") => Object.fromEntries(URGENCIES.map(u => {
  const stopped = out.filter(x => x[mode].outcomes[u].conservative.primary === "stopped");
  const why = (x: Row) => x[mode].reasons[u];
  const signal = (fires: (x: Row) => boolean, others: (x: Row) => boolean) => ({ fires: stopped.filter(fires).length, alone: stopped.filter(x => fires(x) && !others(x)).length });
  return [u, {
    stopped: stopped.length,
    provenance_regression: signal(x => why(x).other.some(o => o.startsWith("provenance")), x => why(x).other.some(o => !o.startsWith("provenance")) || why(x).requery || why(x).not_selected),
    install_scripts: signal(x => why(x).other.some(o => o.startsWith("install scripts")), x => why(x).other.some(o => !o.startsWith("install scripts")) || why(x).requery || why(x).not_selected),
    re_query: signal(x => why(x).requery, x => why(x).other.length > 0),
    not_selected_by_any_fix: signal(x => why(x).not_selected, x => why(x).other.length > 0),
    of_which_selected_only_in_trees_rule1_stops: signal(x => why(x).only_rule1_trees, x => why(x).other.length > 0),
  }];
}));
const sources = (key: keyof Facts) => out.reduce((m, x) => { const s = (x.facts[key] as any).source; m[s] = (m[s] ?? 0) + 1; return m; }, {} as Record<string, number>);
const selectedAt = (x: Row, mode: "with_exception" | "without_exception") => x[mode].selecting.a.length + x[mode].selecting.b.length > 0;
const listed = (x: Row) => ({
  id: x.id, name: x.name, version: x.version, published: x.published, present: x.present, record_hours: x.record_hours,
  selecting_fixes: { with_exception: { a: x.with_exception.selecting.a.length, b: x.with_exception.selecting.b.length }, without_exception: { a: x.without_exception.selecting.a.length, b: x.without_exception.selecting.b.length } },
  first_selecting_fix: { a: x.with_exception.selecting.a[0] ?? null, b: x.with_exception.selecting.b[0] ?? null },
  outcome_with_exception: Object.fromEntries(URGENCIES.map(u => [u, x.with_exception.outcomes[u].conservative.primary])),
  outcome_without_exception: Object.fromEntries(URGENCIES.map(u => [u, x.without_exception.outcomes[u].conservative.primary])),
});
const allowedByException = out.filter(x => [...x.with_exception.selecting.a, ...x.with_exception.selecting.b].some(s => s.allowed_as));
const madePossible = out.filter(x => selectedAt(x, "with_exception") && !selectedAt(x, "without_exception"));
const beforeT = out.filter(x => [...x.with_exception.selecting.a, ...x.with_exception.selecting.b].some(s => s.v_before_t));
const unverified = out.filter(x => x.with_exception.unverified.a.length + x.with_exception.unverified.b.length > 0);
const wouldHaveStopped = Object.fromEntries(URGENCIES.map(u => [u, out.filter(x => x.without_exception.outcomes[u].conservative.primary === "stopped" && x.with_exception.outcomes[u].conservative.primary !== "stopped").map(x => `${x.name}@${x.version}`)]));
const trees = (mode: Mode) => ({
  resolved: results.length,
  stopped_by_rule1: results.filter(x => x[mode].stopped).length,
  with_unknown_branch: results.filter(x => x[mode].unknown).length,
  tree_versions: { median: results.map(x => x[mode].tree.nodes).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null, max: Math.max(0, ...results.map(x => x[mode].tree.nodes)) },
});
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/src/malicious-v4.ts and docs/decisions.md, \"Rule 1's same-release exception, and backtest v4's definitions\".",
  denominator: rows.length,
  fixes: { events: fixEvents.size, with_registry_time: fixes.length, left_out: fixesLeftOut, in_some_window: inWindow.length, with_exception: trees("with"), without_exception: trees("without") },
  exception: {
    trees_where_it_allowed_a_version: results.filter(x => x.with.tree.allowed.length > 0).length,
    allowed_versions: { provenance: new Set(results.flatMap(x => x.with.tree.allowed.filter(a => a.basis === "provenance").map(a => a.version))).size, publisher: new Set(results.flatMap(x => x.with.tree.allowed.filter(a => a.basis === "publisher").map(a => a.version))).size },
    trees_rule1_stops_only_without_it: results.filter(x => x.without.stopped && !x.with.stopped).length,
    trees_with_an_unverified_check: results.filter(x => x.with.tree.unverified.length > 0).length,
    malicious_versions_it_allowed: allowedByException.length,
    malicious_versions_selected_only_with_it: madePossible.length,
    malicious_versions_stopped_without_it_but_not_with_it: wouldHaveStopped,
  },
  by_urgency: { with_exception: byUrgency("with_exception"), without_exception: byUrgency("without_exception") },
  gate_every_malicious_version_stopped: {
    with_exception: URGENCIES.every(u => count("with_exception", u, "conservative", "primary", "stopped") === rows.length) ? "met" : "not met",
    without_exception: URGENCIES.every(u => count("without_exception", u, "conservative", "primary", "stopped") === rows.length) ? "met" : "not met",
  },
  stops_by_signal: { with_exception: stopsBySignal("with_exception"), without_exception: stopsBySignal("without_exception") },
  signal_sources: { provenance: sources("provenance"), new_dependencies: sources("newDeps"), install_scripts: sources("scripts"), publisher: sources("publisher") },
  signal_fires: {
    provenance_regression: out.filter(x => x.facts.provenance.regression).length,
    new_dependencies: out.filter(x => x.facts.newDeps.added).length,
    install_scripts_added: out.filter(x => x.facts.scripts.added).length,
    publisher_changed: out.filter(x => x.facts.publisher.changed).length,
    rule2_could_fire_on_p: out.filter(x => { const c = Date.parse(cached.get(x.name)?.created ?? ""); return !Number.isFinite(c) || c > Date.parse(x.published) - 7 * 24 * H; }).length,
  },
  rule2_note: "Rule 2 cannot fire on P: every P in the denominator has a legitimate version at least 7 days before V, and the longest base wait is 168h.",
  listed: {
    allowed_by_the_exception: allowedByException.map(listed),
    selected_only_with_the_exception: madePossible.map(listed),
    published_before_t_of_a_selecting_fix: beforeT.map(listed),
    exception_check_unverified: unverified.map(x => ({ ...listed(x), unverified_fixes: x.with_exception.unverified })),
    stopped_only_without_the_exception: out.filter(x => URGENCIES.some(u => wouldHaveStopped[u]!.includes(`${x.name}@${x.version}`))).map(x => ({ ...listed(x), unknown_because: x.with_exception.unknown_because })),
  },
  rows: out,
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify(shown, null, 2));
