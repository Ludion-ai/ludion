// Backtest v5, malicious releases (docs/bench/2026-10-28-backtest-v5/definitions.md). Backtest v4 (malicious-v4.ts),
// trees and outcomes unchanged, with two additions:
// - install scripts of a version the registry no longer lists are read from ecosyste.ms, else Software Heritage (only
//   where its answer can change an outcome), under the judge's rule, including (b) with prev no longer listed;
// - the disputed category: a version whose code equals the preceding legitimate version's, shown with the registry's
//   hash and two archives (Software Heritage and jsDelivr). It stays in the denominator and is counted apart.
// Every outcome is also computed with v4's facts and compared with malicious-v4.json.
//
// Usage: node tools/backtest/src/malicious-v5.ts <osv-npm-dir> <malicious-v2.json> <malicious-v4.json> <cache-dir> <out.json> [--only=<name@version>]
// Reads untrusted JSON and tarballs only (in memory); runs nothing from them. Network, read-only and cached:
// registry.npmjs.org, api.deps.dev, packages.ecosyste.ms, data.jsdelivr.com, cdn.jsdelivr.net, archive.softwareheritage.org.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { EXPLOITED_UNCOMPARABLE_HOURS, EXTENDED_MIN_HOURS, installScripts, registryTarball, WAIT_HOURS, type Urgency } from "../../../packages/cli/src/security/judge.ts";
import { provenanceFrom, sharedPublisher } from "../../../packages/cli/src/security/npm-facts.ts";
import { firstPublish, SAME_RELEASE_MINUTES, sameRelease, type ReleaseIdentity, type SameRelease } from "../../../packages/cli/src/security/time-cap.ts";
import { Archive, codeDifferences, ecosystems, jsdelivrFile, jsdelivrList, names, registryTarFiles, registryVersions, scriptsFromFiles, swhFiles, swhLocate, swhManifest, swhMetadata, type EcoRecord, type FileList } from "./archives-v5.ts";

const [osvDir, v2File, v4File, cacheDir, outFile, flag] = process.argv.slice(2);
if (!osvDir || !v2File || !v4File || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/malicious-v5.ts <osv-npm-dir> <malicious-v2.json> <malicious-v4.json> <cache-dir> <out.json> [--only=<name@version>]");
// The first execution is the result: never overwrite an earlier output.
if (existsSync(outFile)) throw new Error(`${outFile} exists; the first execution is the result.`);
const only = flag?.startsWith("--only=") ? flag.slice(7) : null;
if (flag && !only) throw new Error(`Unknown flag ${flag}`);
for (const dir of ["registry", "depsdev", "identity", "attest"]) mkdirSync(join(cacheDir, dir), { recursive: true });
const startedAt = new Date().toISOString();
// Git blob hashes of the files that compute the result (git hash-object), so the output names the code it ran.
const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const blobs = Object.fromEntries(["tools/backtest/src/malicious-v5.ts", "tools/backtest/src/archives-v5.ts", "packages/cli/src/security/judge.ts", "packages/cli/src/security/npm-facts.ts", "packages/cli/src/security/time-cap.ts"].map(f => {
  const b = readFileSync(join(repo, f));
  return [f, createHash("sha1").update(`blob ${b.length}`).update(Buffer.from([0])).update(b).digest("hex")];
}));
const semverVersion = JSON.parse(readFileSync(join(repo, "node_modules/semver/package.json"), "utf8")).version;
const archive = new Archive(cacheDir);

type V2Row = { id: string; name: string; version: string; published: string; previous: string; present: boolean; previous_present: boolean; hours_to_mal: number; hours_to_mal_conservative: number; provenance_regression: boolean; install_scripts_added: boolean; extends: string[]; comparable: boolean };
// --only=<name@version>: a smoke run on one version, with no trees resolved (its output is not a result).
const rows: V2Row[] = (JSON.parse(readFileSync(v2File, "utf8")).rows as V2Row[]).filter(r => !only || `${r.name}@${r.version}` === only);
if (only && !rows.length) throw new Error(`${only} is not in the denominator`);
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
/** Stops by gate 2 signals other than the re-query, exactly as v4 computed them (kept to reproduce v4's outcomes). */
function otherStopV4(r: V2Row, s: Scenario): string[] {
  const f = facts.get(`${r.name}@${r.version}`)!, out: string[] = [];
  if (s === "b" && f.provenance.regression) out.push(`provenance (${f.provenance.source})`);
  if (s === "b" && f.scripts.added) out.push("install scripts added (registry)");
  // (a) has no predecessor: a new package that runs install scripts stops; readable only while the registry lists V.
  if (s === "a" && r.present && cached.get(r.name)?.versions[r.version]?.s) out.push("install scripts on a new package (registry)");
  return out;
}

// --- v5: V's install scripts from the registry, else ecosyste.ms, else Software Heritage (definitions, section 2). ---
type ScriptSource = "registry" | "ecosyste.ms" | "software-heritage" | "unverified";
type Scripts = { names: string[] | null; source: ScriptSource; why?: string; swh?: string };
const scriptsOf = new Map<string, Scripts>();
const ecoOf = new Map<string, EcoRecord | "unreadable">();
/** A listed version's install script names: v4's cache records only whether it has any, so names come from the registry. */
async function registryScripts(name: string, version: string): Promise<string[] | null> {
  const d = cached.get(name);
  if (d?.versions[version] && !d.versions[version]!.s) return [];
  const reg = await registryVersions(archive, cacheDir!, name);
  return reg?.[version]?.scripts ?? null;
}
await pool(rows, 4, async r => {
  const id = `${r.name}@${r.version}`;
  if (r.present) {
    const n = await registryScripts(r.name, r.version);
    scriptsOf.set(id, n ? { names: n, source: "registry" } : { names: null, source: "unverified", why: "registry unreadable" });
    return;
  }
  const e = await ecosystems(archive, r.name, r.version);
  ecoOf.set(id, e);
  if (e !== "unreadable" && e.scripts !== null) { scriptsOf.set(id, { names: e.scripts, source: "ecosyste.ms" }); return; }
  scriptsOf.set(id, { names: null, source: "unverified", why: e === "unreadable" ? "ecosyste.ms unreadable" : e.held ? "ecosyste.ms has no scripts key" : "ecosyste.ms does not hold it" });
});
/** prev's names, from the registry, for (b) when the registry lists prev and V declares an install script. */
const prevScripts = new Map<string, string[] | null>();
async function readPrevScripts(r: V2Row) {
  const key = `${r.name}@${r.previous}`;
  if (r.previous_present && scriptsOf.get(`${r.name}@${r.version}`)!.names?.length && !prevScripts.has(key)) prevScripts.set(key, await registryScripts(r.name, r.previous));
}
await pool(rows, 4, readPrevScripts);
/** The judge's install-script rule on V (judge.ts): no comparable predecessor in (a) or with prev unlisted; else added. */
function scriptStop(r: V2Row, s: Scenario): string | null {
  const v = scriptsOf.get(`${r.name}@${r.version}`)!;
  if (!v.names?.length) return null;
  if (s === "a") return `install scripts on a new package (${v.source})`;
  if (!r.previous_present) return `install scripts, prev not listed (${v.source})`;
  const p = prevScripts.get(`${r.name}@${r.previous}`);
  if (!p) return null;
  return v.names.some(n => !p.includes(n)) ? `install scripts added (${v.source})` : null;
}
/** v5's stops by gate 2 signals other than the re-query: v4's provenance, and the install-script rule above. */
function otherStopV5(r: V2Row, s: Scenario): string[] {
  const f = facts.get(`${r.name}@${r.version}`)!, out: string[] = [];
  if (s === "b" && f.provenance.regression) out.push(`provenance (${f.provenance.source})`);
  const scripts = scriptStop(r, s);
  if (scripts) out.push(scripts);
  return out;
}

// Which fixes can matter: T in (p - 24h, record - smallest wait) for some V. A fix published before V can select V only
// through the exception, which looks at most 24h after T.
const minWait = (r: V2Row) => Math.min(...URGENCIES.flatMap(u => (["a", "b"] as const).map(s => wait(r, u, s))));
const windows = rows.map(r => ({ r, from: Date.parse(r.published) - HORIZON, to: record(r, "conservative") - minWait(r) * H }));
const inWindow = fixes.filter(f => windows.some(w => f.t > w.from && f.t < w.to));
const afterAny = fixes.filter(f => rows.some(r => f.t > Date.parse(r.published) - HORIZON));
console.log(`fixes with a registry time: ${fixes.length}; in some V's window: ${inWindow.length}; published after some V - 24h: ${afterAny.length}`);

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
const toResolve = only ? [] : afterAny;
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
/** Every V's outcomes (v4's rules) under a given set of other gate 2 stops: v4's, or v5's. */
function evaluate(otherStop: (r: V2Row, s: Scenario) => string[]) {
  return rows.map(r => {
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
      // For an unknown V, the fixes whose unreadable branch makes it unknown (as in v4's diagnostic field).
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
    return {
      id: r.id, name: r.name, version: r.version, published: r.published, previous: r.previous, present: r.present, previous_present: r.previous_present,
      record_hours: { conservative: r.hours_to_mal_conservative, optimistic: r.hours_to_mal },
      facts: facts.get(`${r.name}@${r.version}`)!, scripts: scriptsOf.get(`${r.name}@${r.version}`)!, other_stops: { a: otherStop(r, "a"), b: otherStop(r, "b") },
      with_exception: per("with"), without_exception: per("without"),
    };
  });
}
type Row = ReturnType<typeof evaluate>[number];
const MODES = ["with_exception", "without_exception"] as const;
type ModeKey = typeof MODES[number];
const key = (r: { name: string; version: string }) => `${r.name}@${r.version}`;

// --- v4 reproduced: v4's facts and rule, compared version by version with malicious-v4.json. ---
const v4Out = evaluate(otherStopV4);
const v4Published = new Map<string, any>((JSON.parse(readFileSync(v4File!, "utf8")).rows as any[]).map(x => [key(x), x]));
const reproduction: string[] = [];
for (const x of v4Out) {
  const y = v4Published.get(key(x));
  if (!y) { reproduction.push(`${key(x)}: not in malicious-v4.json`); continue; }
  for (const mode of MODES) for (const u of URGENCIES) for (const t of TIMINGS) for (const k of ["a", "b", "primary"] as const) {
    if (x[mode].outcomes[u][t][k] !== y[mode].outcomes[u][t][k]) reproduction.push(`${key(x)} ${mode} ${u} ${t} ${k}: ${x[mode].outcomes[u][t][k]} (v4: ${y[mode].outcomes[u][t][k]})`);
  }
}
console.log(`v4 reproduced: ${reproduction.length} differences`);

// --- Software Heritage for install scripts, rule (i): V's scripts still unverified, and V not stopped somewhere. ---
const notStopped = (x: Row) => MODES.some(m => URGENCIES.some(u => TIMINGS.some(t => x[m].outcomes[u][t].primary !== "stopped")));
const beforeSwh = evaluate(otherStopV5);
const swhForScripts = rows.filter((r, i) => scriptsOf.get(key(r))!.source === "unverified" && notStopped(beforeSwh[i]!));
console.log(`Software Heritage, install scripts: ${swhForScripts.length} versions`);
const swhHolds = new Map<string, Promise<Awaited<ReturnType<typeof swhLocate>>>>();
const locate = (r: V2Row) => { if (!swhHolds.has(key(r))) swhHolds.set(key(r), swhLocate(archive, r.name, r.version, r.published)); return swhHolds.get(key(r))!; };
for (const r of swhForScripts) {
  const before = scriptsOf.get(key(r))!;
  const hold = await locate(r);
  if (hold === "unreadable" || !hold.held) { scriptsOf.set(key(r), { ...before, swh: hold === "unreadable" ? "unreadable" : hold.why }); continue; }
  const m = await swhManifest(archive, hold.packageRoot);
  if (m === "unreadable" || m === "no package.json" || !m.pkg || typeof m.pkg !== "object") { scriptsOf.set(key(r), { ...before, swh: typeof m === "string" ? m : "package.json unparseable" }); continue; }
  scriptsOf.set(key(r), { names: scriptsFromFiles(m.pkg, m.bindingGyp), source: "software-heritage", swh: `held, visit ${hold.visit}` });
  await readPrevScripts(r);
}
const out = evaluate(otherStopV5);

// --- The disputed category (definitions, section 3). ---
// MAL- records per package (not withdrawn), to find the preceding legitimate version prev_d.
const malRecords = new Map<string, any[]>();
for (const file of readdirSync(osvDir!)) {
  if (!file.startsWith("MAL-")) continue;
  const record = JSON.parse(readFileSync(join(osvDir!, file), "utf8"));
  if (record.withdrawn) continue;
  for (const name of new Set<string>((record.affected ?? []).filter((a: any) => a?.package?.ecosystem === "npm").map((a: any) => a.package.name))) {
    if (watched.has(name)) malRecords.set(name, [...(malRecords.get(name) ?? []), record]);
  }
}
const hexToSri = (algo: string, hex: string) => `${algo}-${Buffer.from(hex, "hex").toString("base64")}`;
const normalUrl = (u: string) => { try { return decodeURIComponent(u).replace(/^http:/, "https:"); } catch { return u; } };
type Copy = { source: string; shasum: string | null; integrity: string | null; unpackedSize: number | null };
type Dispute = { step: string; disputed: boolean; prev_d: string | null; evidence?: Record<string, unknown> };
async function dispute(r: V2Row): Promise<Dispute> {
  const d = cached.get(r.name);
  if (!d) return { step: "registry document unreadable", disputed: false, prev_d: null };
  const at = Date.parse(r.published), records = malRecords.get(r.name) ?? [];
  const earlier = Object.keys(d.time).filter(v => Date.parse(d.time[v] ?? "") < at).sort((x, y) => Date.parse(d.time[y]!) - Date.parse(d.time[x]!));
  const prevD = earlier.find(v => !records.some(rec => names(rec, r.name, v))) ?? null;
  const no = (step: string, evidence?: Record<string, unknown>): Dispute => ({ step, disputed: false, prev_d: prevD, ...(evidence ? { evidence } : {}) });
  if (!prevD) return no("no preceding legitimate version");
  if (!d.versions[prevD]) return no("prev_d not listed by the registry");
  const list = await jsdelivrList(archive, r.name, r.version);
  if (list === "unreadable") return no("jsDelivr unreadable");
  if (!list) return no("jsDelivr does not hold V");
  const reg = await registryVersions(archive, cacheDir!, r.name);
  if (!reg) return no("registry unreadable");
  const tar = await registryTarFiles(archive, cacheDir!, r.name, prevD, reg[prevD]?.integrity ?? null);
  if (!tar.ok) return no(`prev_d tarball: ${tar.reason}`);
  const prevFiles: FileList = new Map(tar.files.map(([path, sha, size]) => [path, { sha256: sha, size }]));
  const vPkgBytes = await jsdelivrFile(archive, r.name, r.version, "package.json");
  if (!vPkgBytes || createHash("sha256").update(vPkgBytes).digest("hex") !== list.get("package.json")?.sha256) return no("V's package.json from jsDelivr does not match its list");
  const parse = (text: string | null) => { try { return text === null ? null : JSON.parse(text); } catch { return null; } };
  const differences = codeDifferences(list, parse(vPkgBytes.toString("utf8")), prevFiles, parse(tar.packageJson));
  if (differences.length) return no("code differs from prev_d (jsDelivr's files)", { differences: differences.slice(0, 20), count: differences.length });
  // The copies of the registry's version document: the registry itself when it lists V, ecosyste.ms, Software Heritage.
  const copies: Copy[] = [];
  if (reg[r.version]) copies.push({ source: "registry", shasum: reg[r.version]!.shasum, integrity: reg[r.version]!.integrity, unpackedSize: reg[r.version]!.unpackedSize });
  const eco = ecoOf.get(key(r)) ?? await ecosystems(archive, r.name, r.version);
  if (eco !== "unreadable" && eco.held) copies.push({ source: "ecosyste.ms", shasum: eco.shasum, integrity: eco.integrity, unpackedSize: eco.unpackedSize });
  const jsTotal = [...list.values()].reduce((s, f) => s + f.size, 0);
  const agree = () => (["shasum", "integrity", "unpackedSize"] as const).every(k => new Set(copies.map(c => c[k]).filter(x => x !== null)).size <= 1);
  if (!agree()) return no("copies of the registry's version document disagree", { copies });
  if (copies.some(c => c.unpackedSize !== null && c.unpackedSize !== jsTotal)) return no("unpackedSize differs from jsDelivr's files", { copies, jsdelivr_total: jsTotal });
  // Software Heritage, rule (ii): only now.
  const hold = await locate(r);
  if (hold === "unreadable") return no("Software Heritage unreadable");
  if (!hold.held) return no("Software Heritage does not hold V", { why: hold.why });
  const swh = await swhFiles(archive, hold.packageRoot);
  if (swh === "unreadable") return no("Software Heritage unreadable");
  const paths = new Set([...swh.keys(), ...list.keys()]);
  const differ = [...paths].filter(p => swh.get(p)?.sha256 !== list.get(p)?.sha256);
  if (differ.length) return no("the two archives differ", { paths: differ.slice(0, 20), count: differ.length });
  const meta = await swhMetadata(archive, hold.root);
  if (meta === "unreadable") return no("Software Heritage unreadable");
  if (meta.dist) copies.push({ source: "software-heritage", shasum: typeof meta.dist.shasum === "string" ? meta.dist.shasum : null, integrity: typeof meta.dist.integrity === "string" ? meta.dist.integrity : null, unpackedSize: typeof meta.dist.unpackedSize === "number" ? meta.dist.unpackedSize : null });
  if (!agree()) return no("copies of the registry's version document disagree", { copies });
  if (copies.some(c => c.unpackedSize !== null && c.unpackedSize !== jsTotal)) return no("unpackedSize differs from jsDelivr's files", { copies, jsdelivr_total: jsTotal });
  const shasum = copies.find(c => c.shasum)?.shasum ?? null, integrity = copies.find(c => c.integrity)?.integrity ?? null;
  if (!shasum && !integrity) return no("no copy gives the registry's hash", { copies });
  const tarball = normalUrl(registryTarball(r.name, r.version));
  const tied = meta.artifacts.find(a => typeof a?.url === "string" && normalUrl(a.url) === tarball && ((shasum && a.checksums?.sha1 === shasum) || (integrity && typeof a.checksums?.sha512 === "string" && hexToSri("sha512", a.checksums.sha512) === integrity)));
  if (!tied) return no("Software Heritage's artifact is not tied to the registry's hash", { copies, artifacts: meta.artifacts });
  return {
    step: "disputed", disputed: true, prev_d: prevD,
    evidence: { copies, artifact: tied, swh_visit: hold.visit, swh_root: hold.root, files: list.size, inert_or_removed: [...list.keys()].filter(p => p !== "package.json" && prevFiles.get(p)?.sha256 !== list.get(p)!.sha256).concat([...prevFiles.keys()].filter(p => !list.has(p)).map(p => `removed: ${p}`)) },
  };
}
const disputes = new Map<string, Dispute>();
let disputed = 0;
await pool(rows, 4, async r => { disputes.set(key(r), await dispute(r)); if (++disputed % 200 === 0) console.log(`disputed check ${disputed}/${rows.length}`); });

// --- Results. ---
const count = (rowsIn: Row[], mode: ModeKey, u: Urgency, timing: Timing, k: "a" | "b" | "primary", o: Outcome) => rowsIn.filter(x => x[mode].outcomes[u][timing][k] === o).length;
const tally = (rowsIn: Row[], mode: ModeKey) => Object.fromEntries(URGENCIES.map(u => [u, Object.fromEntries(TIMINGS.map(timing => [timing, Object.fromEntries((["primary", "a", "b"] as const).map(k => [k, { stopped: count(rowsIn, mode, u, timing, k, "stopped"), missed: count(rowsIn, mode, u, timing, k, "missed"), unknown: count(rowsIn, mode, u, timing, k, "unknown") }]))]))]));
/** The stop rate as an interval: unknown counted as missed (lower) and as stopped (upper). */
const interval = (rowsIn: Row[], mode: ModeKey) => Object.fromEntries(URGENCIES.map(u => [u, Object.fromEntries(TIMINGS.map(timing => {
  const s = count(rowsIn, mode, u, timing, "primary", "stopped"), k = count(rowsIn, mode, u, timing, "primary", "unknown");
  return [timing, { lower: `${s} / ${rowsIn.length}`, upper: `${s + k} / ${rowsIn.length}` }];
}))]));
const SIGNALS: [string, (o: string) => boolean][] = [
  ["provenance_regression", o => o.startsWith("provenance")],
  ["install_scripts", o => o.startsWith("install scripts")],
  ["install_scripts_registry", o => o.startsWith("install scripts") && o.endsWith("(registry)")],
  ["install_scripts_ecosyste.ms", o => o.startsWith("install scripts") && o.endsWith("(ecosyste.ms)")],
  ["install_scripts_software_heritage", o => o.startsWith("install scripts") && o.endsWith("(software-heritage)")],
];
const stopsBySignal = (rowsIn: Row[], mode: ModeKey) => Object.fromEntries(URGENCIES.map(u => {
  const stopped = rowsIn.filter(x => x[mode].outcomes[u].conservative.primary === "stopped");
  const why = (x: Row) => x[mode].reasons[u];
  const signal = (fires: (x: Row) => boolean, others: (x: Row) => boolean) => ({ fires: stopped.filter(fires).length, alone: stopped.filter(x => fires(x) && !others(x)).length });
  const otherSignal = Object.fromEntries(SIGNALS.map(([name, test]) => [name, signal(x => why(x).other.some(test), x => why(x).other.some(o => !test(o)) || why(x).requery || why(x).not_selected)]));
  return [u, {
    stopped: stopped.length,
    ...otherSignal,
    re_query: signal(x => why(x).requery, x => why(x).other.length > 0),
    not_selected_by_any_fix: signal(x => why(x).not_selected, x => why(x).other.length > 0),
    of_which_selected_only_in_trees_rule1_stops: signal(x => why(x).only_rule1_trees, x => why(x).other.length > 0),
  }];
}));
/** Versions whose outcome differs from v4's (primary, conservative, with the exception), and the stops behind it. */
const changes = Object.fromEntries(URGENCIES.map(u => {
  const moved = out.map((x, i) => ({ x, before: v4Out[i]!.with_exception.outcomes[u].conservative.primary, after: x.with_exception.outcomes[u].conservative.primary })).filter(m => m.before !== m.after);
  const bySource: Record<string, number> = {};
  for (const m of moved) for (const o of m.x.with_exception.reasons[u].other) bySource[o.replace(/^.*\(/, "(")] = (bySource[o.replace(/^.*\(/, "(")] ?? 0) + 1;
  return [u, {
    moved: moved.length,
    from_to: moved.reduce((acc, m) => { const k = `${m.before} -> ${m.after}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    by_stop_source: bySource,
    versions: moved.map(m => ({ version: key(m.x), from: m.before, to: m.after, other_stops: m.x.with_exception.reasons[u].other })),
  }];
}));
const scriptSources = rows.reduce((acc, r) => { const s = scriptsOf.get(key(r))!.source; acc[s] = (acc[s] ?? 0) + 1; return acc; }, {} as Record<string, number>);
const removed = rows.filter(r => !r.present);
const ecoRead = removed.map(r => ecoOf.get(key(r)));
const funnel = [...disputes.values()].reduce((acc, d) => { acc[d.step] = (acc[d.step] ?? 0) + 1; return acc; }, {} as Record<string, number>);
const disputedRows = out.filter(x => disputes.get(key(x))!.disputed);
const otherRows = out.filter(x => !disputes.get(key(x))!.disputed);
const swhSummary = {
  for_install_scripts: { read: swhForScripts.length, held: swhForScripts.filter(r => scriptsOf.get(key(r))!.source === "software-heritage").length, not_held_or_unreadable: swhForScripts.filter(r => scriptsOf.get(key(r))!.source !== "software-heritage").map(r => ({ version: key(r), why: scriptsOf.get(key(r))!.swh })) },
  for_disputed: [...disputes.entries()].filter(([, d]) => d.step === "disputed" || /Software Heritage|archives differ|artifact|copies|no copy/.test(d.step)).length,
};
const trees = (mode: Mode) => ({
  resolved: results.length,
  stopped_by_rule1: results.filter(x => x[mode].stopped).length,
  with_unknown_branch: results.filter(x => x[mode].unknown).length,
  tree_versions: { median: results.map(x => x[mode].tree.nodes).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null, max: Math.max(0, ...results.map(x => x[mode].tree.nodes)) },
});
const result = {
  run: { started_at: startedAt, ended_at: new Date().toISOString(), smoke: only, blobs, semver: semverVersion, node: process.version },
  method: "docs/bench/2026-10-28-backtest-v5/definitions.md; the header of tools/backtest/src/malicious-v5.ts.",
  denominator: rows.length,
  fixes: { events: fixEvents.size, with_registry_time: fixes.length, left_out: fixesLeftOut, in_some_window: inWindow.length, with_exception: trees("with"), without_exception: trees("without") },
  v4_reproduced: { differences: reproduction.length, first: reproduction.slice(0, 50) },
  by_urgency: { with_exception: tally(out, "with_exception"), without_exception: tally(out, "without_exception") },
  stop_rate_interval: { with_exception: interval(out, "with_exception"), without_exception: interval(out, "without_exception") },
  gate_every_malicious_version_stopped: {
    with_exception: URGENCIES.every(u => count(out, "with_exception", u, "conservative", "primary", "stopped") === rows.length) ? "met" : "not met",
    without_exception: URGENCIES.every(u => count(out, "without_exception", u, "conservative", "primary", "stopped") === rows.length) ? "met" : "not met",
  },
  stops_by_signal: { with_exception: stopsBySignal(out, "with_exception"), without_exception: stopsBySignal(out, "without_exception") },
  v4_stops_by_signal_reproduced: { with_exception: stopsBySignal(v4Out, "with_exception") },
  changes_from_v4_with_exception: changes,
  install_scripts: {
    source_of_v_fact: scriptSources,
    ecosystems_for_removed_v: { read: removed.length, held_with_scripts_key: ecoRead.filter(e => e && e !== "unreadable" && e.scripts !== null).length, held_without_scripts_key: ecoRead.filter(e => e && e !== "unreadable" && e.held && e.scripts === null).length, not_held: ecoRead.filter(e => e && e !== "unreadable" && !e.held).length, unreadable: ecoRead.filter(e => e === "unreadable").length },
    v_declares_any: rows.filter(r => scriptsOf.get(key(r))!.names?.length).length,
    fires: { a: rows.filter(r => scriptStop(r, "a")).length, b: rows.filter(r => scriptStop(r, "b")).length, either: rows.filter(r => scriptStop(r, "a") || scriptStop(r, "b")).length },
    prev_names_unreadable: rows.filter(r => r.previous_present && scriptsOf.get(key(r))!.names?.length && !prevScripts.get(`${r.name}@${r.previous}`)).map(key),
  },
  software_heritage: swhSummary,
  disputed: {
    funnel,
    count: disputedRows.length,
    by_urgency: { disputed: tally(disputedRows, "with_exception"), others: tally(otherRows, "with_exception") },
    versions: disputedRows.map(x => ({ version: key(x), id: x.id, published: x.published, ...disputes.get(key(x))!, outcome_with_exception: Object.fromEntries(URGENCIES.map(u => [u, x.with_exception.outcomes[u].conservative.primary])) })),
  },
  requests: archive.counters,
  rule2_note: "Rule 2 cannot fire on P: every P in the denominator has a legitimate version at least 7 days before V, and the longest base wait is 168h.",
  rows: out.map(x => ({ ...x, disputed: disputes.get(key(x))! })),
};
result.run.ended_at = new Date().toISOString();
writeFileSync(outFile!, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify({ ...shown, changes_from_v4_with_exception: Object.fromEntries(Object.entries(changes).map(([u, c]) => [u, { moved: c.moved, from_to: c.from_to, by_stop_source: c.by_stop_source }])) }, null, 2));
