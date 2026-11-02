// LC3: main's judge on backtest v4's 200 fixes, the split of deprecations, and the next candidate
// (docs/decisions/2026-11-01-lc3-definitions.md, which fixes every choice here). Reads only: registry packuments and
// attestation records, OSV, and the judge's whole KEV and EPSS lists. No tarball is fetched and no package code runs.
//
// Run in Docker only (run.sh): node measure.mjs <fixes-v4.json> <cache-dir> <out.json> [row-limit]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { judge, registryTarball, releaseIdentity } from "../../../packages/cli/src/security/judge.ts";
import { gatherFacts, osvIds, provenanceFrom, sharedPublisher } from "../../../packages/cli/src/security/npm-facts.ts";
import { comparePublishers, nextFix } from "../../../packages/cli/src/security/next-fix.ts";
import { SAME_RELEASE_MINUTES, sameRelease } from "../../../packages/cli/src/security/time-cap.ts";

const [v4File, cacheDir, outFile, limit] = process.argv.slice(2);
if (!v4File || !cacheDir || !outFile) throw new Error("Usage: measure.mjs <fixes-v4.json> <cache-dir> <out.json> [row-limit]");
for (const dir of ["http", "registry", "identity", "attest"]) mkdirSync(join(cacheDir, dir), { recursive: true });
const H = 3_600_000, HORIZON = 24 * H, NOW = new Date("2100-01-01T00:00:00Z");
const v4 = JSON.parse(readFileSync(v4File, "utf8"));
const rows = limit ? v4.rows.slice(0, Number(limit)) : v4.rows;
const startedAt = new Date().toISOString();

// ---- Every request of the judge's code goes through this: retries and a disk cache. Not part of what is measured. ----
const stats = { requests: 0, retried: 0, failed: [] };
const save = (file, text) => { writeFileSync(`${file}.tmp`, text); renameSync(`${file}.tmp`, file); };
async function cachedFetch(url, init = {}) {
  const u = String(url), method = init.method ?? "GET";
  const file = join(cacheDir, "http", createHash("sha256").update(`${method}\0${u}\0${init.body ?? ""}`).digest("hex"));
  if (existsSync(`${file}.meta`)) {
    const meta = JSON.parse(readFileSync(`${file}.meta`, "utf8"));
    return new Response(meta.status >= 300 && meta.status < 400 ? null : readFileSync(file), { status: meta.status, headers: meta.location ? { location: meta.location } : {} });
  }
  for (let attempt = 0; ; attempt++) {
    stats.requests++;
    let res = null, problem = null;
    try { res = await fetch(u, { ...init, signal: AbortSignal.timeout(180_000) }); } catch (error) { problem = String(error); }
    if (res && (res.status === 200 || res.status === 404 || (res.status >= 300 && res.status < 400))) {
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400) { await res.body?.cancel().catch(() => {}); save(`${file}.meta`, JSON.stringify({ status: res.status, location })); return new Response(null, { status: res.status, headers: location ? { location } : {} }); }
      const body = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, body);
      save(`${file}.meta`, JSON.stringify({ status: res.status }));
      return new Response(body, { status: res.status });
    }
    await res?.body?.cancel().catch(() => {});
    if (attempt < 4) { stats.retried++; await new Promise(r => setTimeout(r, 3_000 * (attempt + 1))); continue; }
    stats.failed.push(`${method} ${u}: ${res?.status ?? problem}`);
    if (res) return new Response(null, { status: res.status });
    throw new Error(problem ?? `${u}: no response`);
  }
}

// ---- Rule 1 on a fresh resolution, as tools/backtest/src/fixes-v4.ts does it, with main's sameRelease. ----
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
const registryPath = name => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    stats.requests++;
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Ludion-Backtest" }, signal: AbortSignal.timeout(300_000) }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) return res.json();
    if (attempt < 4) { stats.retried++; await new Promise(r => setTimeout(r, 3_000 * (attempt + 1))); continue; }
    stats.failed.push(`GET ${url}: ${res?.status ?? "no response"}`);
    throw new Error(`${url}: ${res?.status ?? "no response"}`);
  }
}
function saveIdentities(name, raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw?.versions ?? {})) out[k] = { u: typeof v?._npmUser?.name === "string" && !sharedPublisher(v._npmUser) ? v._npmUser.name : null, a: !!v?.dist?.attestations, i: typeof v?.dist?.integrity === "string" ? v.dist.integrity : null };
  save(join(cacheDir, "identity", `${encodeURIComponent(name)}.json`), JSON.stringify(out));
  return out;
}
const memo = new Map();
function doc(name) {
  if (!memo.has(name)) memo.set(name, (async () => {
    if (!NAME.test(name)) return "error";
    const file = join(cacheDir, "registry", `${encodeURIComponent(name)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    let raw;
    try { raw = await getJson(`https://registry.npmjs.org/${registryPath(name)}`); } catch (error) { console.error(String(error)); return "error"; }
    if (!raw) return null;
    const out = { time: {}, versions: {} };
    for (const [k, v] of Object.entries(raw.time ?? {})) if (typeof v === "string" && semver.valid(k)) out.time[k] = v;
    for (const [k, v] of Object.entries(raw.versions ?? {})) {
      const pick = o => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length ? Object.fromEntries(Object.entries(o).filter(([, s]) => typeof s === "string")) : undefined;
      const optionalPeers = Object.entries(v?.peerDependenciesMeta ?? {}).filter(([, m]) => m?.optional).map(([n]) => n);
      const bundled = Array.isArray(v?.bundleDependencies) ? v.bundleDependencies : Array.isArray(v?.bundledDependencies) ? v.bundledDependencies : undefined;
      out.versions[k] = { d: pick(v?.dependencies), o: pick(v?.optionalDependencies), p: pick(v?.peerDependencies), ...(optionalPeers.length ? { po: optionalPeers } : {}), ...(bundled?.length ? { b: bundled.filter(x => typeof x === "string") } : {}) };
    }
    saveIdentities(name, raw);
    save(file, JSON.stringify(out));
    return out;
  })());
  return memo.get(name);
}
async function pool(items, n, work) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]); } }));
  return out;
}
const idMemo = new Map();
function identities(name) {
  if (!idMemo.has(name)) idMemo.set(name, (async () => {
    const file = join(cacheDir, "identity", `${encodeURIComponent(name)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    try { const raw = await getJson(`https://registry.npmjs.org/${registryPath(name)}`); return raw ? saveIdentities(name, raw) : "error"; } catch (error) { console.error(String(error)); return "error"; }
  })());
  return idMemo.get(name);
}
const provMemo = new Map();
function provenance(name, version, integrity) {
  const key = `${name}@${version}`;
  if (!provMemo.has(key)) provMemo.set(key, (async () => {
    const file = join(cacheDir, "attest", `${encodeURIComponent(key)}.json`);
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")).p;
    try {
      const raw = await getJson(`https://registry.npmjs.org/-/npm/v1/attestations/${registryPath(name)}@${encodeURIComponent(version)}`);
      if (!raw) return "error";
      const out = provenanceFrom(raw, { name, version, integrity });
      save(file, JSON.stringify({ p: out }));
      return out;
    } catch (error) { console.error(`${key}: ${String(error)}`); return "error"; }
  })());
  return provMemo.get(key);
}
async function identityOf(name, version, d) {
  if (!d.versions[version]) return "removed";
  const ids = await identities(name);
  if (ids === "error" || !ids[version]) return "error";
  const prov = ids[version].a ? await provenance(name, version, ids[version].i) : null;
  if (prov === "error") return "error";
  return { publisher: ids[version].u, provenance: prov };
}
function parseSpec(name, spec) {
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.*))?$/.exec(spec);
  if (alias) return { name: alias[1], range: alias[2] || "*" };
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:)|^[^@\s]+\/[^@\s]+(?:#.*)?$/.test(spec)) return "skip";
  if (spec === "" || spec === "latest") return { name, range: "*" };
  return semver.validRange(spec) ? { name, range: spec } : null;
}
const highestBefore = (d, range, t) => semver.maxSatisfying(Object.keys(d.time).filter(v => Date.parse(d.time[v] ?? "") < t), range);
async function exception(fix, own, name, version, at, d) {
  if (!own.provenance && (!own.publisher || version !== fix.version || at - fix.t > SAME_RELEASE_MINUTES * 60_000)) return "no";
  if (own.provenance && (!own.provenance.repository || !own.provenance.workflow || !own.provenance.commit)) return "no";
  const other = await identityOf(name, version, d);
  if (other === "removed") return "unverified";
  if (other === "error") return "unreadable";
  return sameRelease({ version: fix.version, published: fix.t, identity: own }, { version, published: at, identity: other }, fix.t) ?? "no";
}
const trees = new Map();
function rule1(fix, own) {
  const key = `${fix.name}@${fix.version}`;
  if (!trees.has(key)) trees.set(key, resolve(fix, own));
  return trees.get(key);
}
async function resolve(fix, own) {
  const out = { unsatisfiable: [], unknown: [], allowed: [], newest: fix.t, nodes: 0 };
  const seen = new Set();
  let frontier = [{ name: fix.name, version: fix.version }];
  while (frontier.length && out.nodes <= 20_000) {
    await pool([...new Set(frontier.map(n => n.name))], 16, n => doc(n));
    const next = new Map();
    for (const node of frontier) {
      const key = `${node.name}@${node.version}`;
      if (seen.has(key)) continue;
      seen.add(key); out.nodes++;
      const d = await doc(node.name);
      if (d === null || d === "error" || !d.versions[node.version]) { out.unknown.push(key); continue; }
      const m = d.versions[node.version];
      const reqs = { ...m.p, ...m.o, ...m.d };
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
      const later = Object.keys(d.time).map(v => ({ v, at: Date.parse(d.time[v] ?? "") })).filter(c => c.at >= fix.t && c.at < fix.t + HORIZON && semver.satisfies(c.v, n.range) && (!chosen || semver.gt(c.v, chosen))).sort((a, b) => semver.rcompare(a.v, b.v));
      for (const c of later) {
        const basis = await exception(fix, own, n.name, c.v, c.at, d);
        if (basis === "provenance" || basis === "publisher") {
          chosen = c.v;
          if (!out.allowed.some(a => a.version === `${n.name}@${c.v}`)) out.allowed.push({ version: `${n.name}@${c.v}`, published: d.time[c.v], basis });
          out.newest = Math.max(out.newest, c.at);
          break;
        }
        if (basis !== "no") out.unknown.push(`${n.name}@${c.v}: the same-release check is ${basis}`);
      }
      if (!chosen) { out.unsatisfiable.push(`${n.name}@${n.range}`); continue; }
      if (!seen.has(`${n.name}@${chosen}`)) frontier.push({ name: n.name, version: chosen });
    }
  }
  if (out.nodes > 20_000) out.unknown.push("tree larger than 20,000 versions");
  return out;
}

// ---- The stop signals (definitions, section 2). ----
function signalOf(finding) {
  const m = finding.message;
  if (/^A lookup failed|^No registry facts|has no publish time/.test(m)) return "facts unreadable";
  if (finding.gate === 4) return "gate 4";
  const signals = [
    [/^Time cap: no version of .* was published before the fix/, "rule 1 (tree)"],
    [/^New dependency /, "rule 2"],
    [/ is deprecated/, "deprecation"],
    [/malicious-package records/, "MAL- record"],
    [/no longer listed/, "withdrawn"],
    [/GitHub repository id/, "provenance: repository id"],
    [/was published from a GitHub|no triggering event/, "provenance: event"],
    [/had build provenance|was built from/, "provenance"],
    [/install scripts/, "install scripts"],
    [/has known advisories/, "gate 1: new advisories"],
    [/ goes down from /, "gate 1: downgrade"],
    [/^Time cap:/, "time cap undecidable"],
  ];
  return signals.find(([pattern]) => pattern.test(m))?.[1] ?? "other";
}

// ---- Facts read beside the judge, by the same fetch: only names, versions and the ids OSV returned. ----
const summaries = new Map();
function summary(name) {
  if (!summaries.has(name)) summaries.set(name, (async () => {
    try {
      const res = await cachedFetch(`https://registry.npmjs.org/${registryPath(name)}`, { headers: { accept: "application/json" } });
      if (!res.ok) return null;
      const raw = await res.json();
      const listed = new Map(Object.entries(raw.versions ?? {}).map(([v, m]) => [v, typeof m?.deprecated === "string" && m.deprecated ? m.deprecated : null]));
      return { time: raw.time ?? {}, modified: typeof raw.time?.modified === "string" ? raw.time.modified : null, listed };
    } catch (error) { console.error(`${name}: ${String(error)}`); return null; }
  })());
  return summaries.get(name);
}
const records = new Map();
function record(id) {
  if (!records.has(id)) records.set(id, (async () => {
    try {
      const res = await cachedFetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
      if (!res.ok) return { id, published: null, withdrawn: false, aliases: [], unread: true };
      const r = await res.json();
      return { id, published: typeof r.published === "string" ? r.published : null, withdrawn: !!r.withdrawn, aliases: Array.isArray(r.aliases) ? r.aliases.filter(a => typeof a === "string") : [] };
    } catch (error) { console.error(`${id}: ${String(error)}`); return { id, published: null, withdrawn: false, aliases: [], unread: true }; }
  })());
  return records.get(id);
}
const osvMemo = new Map();
/** Each version's OSV ids, with withdrawn records left out; a failed query throws. */
async function namedBy(name, versions) {
  const missing = versions.filter(v => !osvMemo.has(`${name}@${v}`));
  if (missing.length) {
    const found = await osvIds(missing.map(version => ({ name, version })), cachedFetch);
    for (const [key, ids] of found) {
      const kept = [];
      for (const id of ids) if (!(await record(id)).withdrawn) kept.push(id);
      osvMemo.set(key, kept);
    }
  }
  return new Map(versions.map(v => [v, osvMemo.get(`${name}@${v}`) ?? []]));
}

// ---- The readings (definitions, section 4). ----
const counted = async (reading, id, cutoff) => {
  if (reading !== "C") return true;
  const published = Date.parse((await record(id)).published ?? "");
  return !Number.isFinite(published) || published <= cutoff; // Not known: it counts.
};
async function known(name, cutoff) {
  const s = await summary(name), at = Date.parse(s?.modified ?? "");
  return Number.isFinite(at) && at <= cutoff;
}
async function readingFacts(facts, reading, cutoff) {
  if (reading === "A") return facts;
  const out = new Map();
  for (const [key, f] of facts) {
    const name = key.slice(0, key.lastIndexOf("@")), advisories = [];
    for (const id of f.advisories) if (await counted(reading, id, cutoff)) advisories.push(id);
    out.set(key, { ...f, deprecated: await known(name, cutoff) ? f.deprecated : null, advisories });
  }
  return out;
}

/** The judge's facts for one change, once per change; a failed lookup is an error the judge turns into undecidable. */
const gathered = new Map();
function factsFor(name, from, to) {
  const key = `${name}\0${from}\0${to}`;
  if (!gathered.has(key)) gathered.set(key, (async () => {
    const change = { path: `node_modules/${name}`, name, from, to, dev: false, resolved: registryTarball(name, to), integrity: null, replaced: null };
    try {
      const { facts, fixes, created } = await gatherFacts([change], cachedFetch);
      return { change: { ...change, integrity: facts.get(`${name}@${to}`)?.integrity ?? null }, facts, fixes, created, errors: [] };
    } catch (error) { return { change, facts: new Map(), fixes: [], created: new Map(), errors: [error instanceof Error ? error.message : String(error)] }; }
  })());
  return gathered.get(key);
}

/** main's judge and rule 1 on from -> to, under one reading. */
async function judged(row, to, reading, cutoff) {
  const g = await factsFor(row.name, row.from, to);
  const facts = await readingFacts(g.facts, reading, cutoff);
  const j = judge({ changes: [g.change], facts, fixes: g.fixes, created: g.created, direct: [row.name], files: ["package-lock.json"], errors: g.errors, now: NOW });
  const fact = g.facts.get(`${row.name}@${to}`);
  const own = fact ? releaseIdentity(fact) : { publisher: null, provenance: null };
  const t = Date.parse(fact?.published_at ?? (to === row.to ? row.fix_published : ""));
  const tree = await rule1({ name: row.name, version: to, t }, own);
  const stopFindings = j.findings.filter(f => f.effect === "stop");
  const signals = stopFindings.map(signalOf);
  if (tree.unsatisfiable.length) signals.push("rule 1 (tree)");
  const stopped = j.verdict === "stop" || j.verdict === "undecidable" || tree.unsatisfiable.length > 0;
  return {
    verdict: tree.unsatisfiable.length && j.verdict === "ready_except_build" ? "stop" : j.verdict, stopped, urgency: j.urgency, wait_hours: j.wait_hours,
    signals: [...new Set(signals)].sort(),
    stops: [...stopFindings.map(f => f.message.slice(0, 400)), ...tree.unsatisfiable.map(r => `Time cap: no version of ${r} was published before the fix or is the same release.`)],
    extended: j.findings.filter(f => f.effect === "extend").length > 0,
    added_delay_hours: stopped ? null : Math.max(0, Math.round((tree.newest + j.wait_hours * H - Date.parse(row.advisory_published)) / 360_000) / 10),
    rule1_unsatisfiable: tree.unsatisfiable, rule1_unknown: tree.unknown.length, tree_versions: tree.nodes, allowed: tree.allowed.length,
    fixes: g.fixes.map(f => ({ id: f.id, kev: f.kev, severity: f.severity, epss: f.epss, epss_date: f.epss_date })),
  };
}

/** The one candidate of definitions section 4. */
async function drawCandidate(row, reading, cutoff) {
  const s = await summary(row.name);
  if (!s) return { none: "registry document not readable", passed_over: [] };
  const toIds = (await namedBy(row.name, [row.to])).get(row.to);
  const mal = toIds.filter(id => id.startsWith("MAL-"));
  if (mal.length) return { none: "the smallest has a MAL- record", malicious: mal, passed_over: [] };
  const fromIds = (await namedBy(row.name, [row.from])).get(row.from);
  const looked = Object.keys(s.time).filter(v => semver.valid(v) === v && !semver.prerelease(v) && semver.gt(v, row.to) && semver.major(v) === semver.major(row.to) && Date.parse(s.time[v]) <= cutoff).sort(semver.compare);
  if (!looked.length) return { none: "no later version of the major published by the cutoff", passed_over: [] };
  const ask = looked.filter(v => s.listed.has(v));
  const named = await namedBy(row.name, ask);
  const passed_over = [];
  for (const v of looked) {
    if (!s.listed.has(v)) { passed_over.push({ version: v, reason: "not listed" }); continue; }
    if (s.listed.get(v) && (reading === "A" || await known(row.name, cutoff))) { passed_over.push({ version: v, reason: "deprecated" }); continue; }
    const ids = named.get(v);
    if (ids.some(id => id.startsWith("MAL-"))) { passed_over.push({ version: v, reason: "MAL- record" }); continue; }
    if (ids.includes(row.id)) { passed_over.push({ version: v, reason: "named by the row's advisory" }); continue; }
    const fresh = [];
    for (const id of ids) if (!fromIds.includes(id) && await counted(reading, id, cutoff)) fresh.push(id);
    if (fresh.length) { passed_over.push({ version: v, reason: "new advisory", ids: fresh }); continue; }
    return { version: v, published: s.time[v], osv_named: ids, passed_over };
  }
  return { none: "every version published by the cutoff was passed over", passed_over };
}

async function redraw(row, reading, cutoff) {
  const c = await drawCandidate(row, reading, cutoff);
  if (c.none) return { ...c, passes: false };
  const smallest = (await factsFor(row.name, row.from, row.to)).facts.get(`${row.name}@${row.to}`);
  const taken = (await factsFor(row.name, row.from, c.version)).facts.get(`${row.name}@${c.version}`);
  const check = comparePublishers(row.to, smallest?.present ? releaseIdentity(smallest) : null, c.version, taken?.present ? releaseIdentity(taken) : null);
  const j = await judged(row, c.version, reading, cutoff);
  const zeroOtherMinor = semver.major(row.to) === 0 && semver.minor(c.version) !== semver.minor(row.to);
  return {
    version: c.version, published: c.published, passed_over: c.passed_over, publisher_check: check.result, publisher_detail: check.detail.slice(0, 500),
    verdict: j.verdict, signals: j.signals, stops: j.stops, wait_hours: j.wait_hours, urgency: j.urgency, extended: j.extended, added_delay_hours: j.added_delay_hours, rule1_unknown: j.rule1_unknown, tree_versions: j.tree_versions,
    gates_pass: !j.stopped, passes: !j.stopped && check.result !== "stop",
    in_next_fix_limits: !zeroOtherMinor && c.osv_named.length === 0, osv_named: c.osv_named,
  };
}

// ---- Section 3: the kind of each deprecation. ----
async function deprecationKind(row, message, cutoff) {
  const s = await summary(row.name);
  if (await known(row.name, cutoff)) return { kind: "K", evidence: [`time.modified ${s.modified}`] };
  const evidence = [];
  for (const [token] of message.matchAll(/\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/g)) {
    const v = token.replace(/^v/, ""), at = Date.parse(s?.time?.[v] ?? "");
    if (Number.isFinite(at) && at > cutoff) evidence.push(`names version ${v}, published ${s.time[v]}`);
  }
  const ids = new Map();
  try {
    const named = await namedBy(row.name, [row.from, row.to]);
    for (const id of [...named.values()].flat()) { const r = await record(id); for (const name of [id, ...r.aliases]) ids.set(name.toUpperCase(), r); }
  } catch (error) { console.error(`${row.name}: ${String(error)}`); }
  for (const [token] of message.matchAll(/GHSA(?:-[0-9a-z]{4}){3}|CVE-\d{4}-\d{4,}/gi)) {
    const r = ids.get(token.toUpperCase()), at = Date.parse(r?.published ?? "");
    if (Number.isFinite(at) && at > cutoff) evidence.push(`names ${token}, OSV record ${r.id} published ${r.published}`);
  }
  for (const [token] of message.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) {
    const at = Date.parse(token);
    if (Number.isFinite(at) && at > cutoff) evidence.push(`names the date ${token}`);
  }
  return { kind: evidence.length ? "L" : "U", evidence: [...new Set(evidence)] };
}

// ---- The run. ----
const out = [];
for (const [index, row] of rows.entries()) {
  const main = await judged(row, row.to, "A", 0);
  const T = Date.parse(row.fix_published), cutoff = T + main.wait_hours * H;
  const s = await summary(row.name);
  const v4Row = row.with_exception;
  const result = {
    id: row.id, name: row.name, from: row.from, to: row.to, fix_published: row.fix_published, advisory_published: row.advisory_published,
    registry_time_differs: !!s && s.time?.[row.to] !== row.fix_published,
    urgency: main.urgency, wait_hours: main.wait_hours, cutoff: new Date(cutoff).toISOString(), modified: s?.modified ?? null,
    verdict: main.verdict, stopped: main.stopped, signals: main.signals, stops: main.stops, extended: main.extended, added_delay_hours: main.added_delay_hours,
    rule1_unsatisfiable: main.rule1_unsatisfiable, rule1_unknown: main.rule1_unknown, tree_versions: main.tree_versions, allowed: main.allowed, fixes: main.fixes,
    v4: { verdict: v4Row.verdict, signals: v4Row.signals, wait_hours: row.wait_hours, urgency: row.urgency },
  };
  if (main.stopped) {
    const fact = (await factsFor(row.name, row.from, row.to)).facts.get(`${row.name}@${row.to}`);
    if (main.signals.includes("deprecation") && fact?.deprecated) result.deprecation = { message: fact.deprecated.slice(0, 500), ...(await deprecationKind(row, fact.deprecated, cutoff)) };
    result.readings = {};
    for (const reading of ["A", "B", "C"]) {
      const asIs = reading === "A" ? main : await judged(row, row.to, reading, cutoff);
      const entry = { stopped_as_is: asIs.stopped, signals_as_is: asIs.signals };
      if (asIs.stopped) { try { entry.candidate = await redraw(row, reading, cutoff); } catch (error) { entry.candidate = { none: `a lookup failed: ${String(error).slice(0, 300)}`, passes: false, passed_over: [] }; } }
      entry.final_stopped = asIs.stopped && !entry.candidate?.passes;
      result.readings[reading] = entry;
    }
    try {
      const choice = await nextFix(row.name, row.to, cachedFetch);
      const at = choice?.chosen ? Date.parse(s?.time?.[choice.chosen] ?? "") : NaN;
      result.main_next_fix = choice ? { chosen: choice.chosen, published: choice.chosen ? s?.time?.[choice.chosen] ?? null : null, within_cutoff: Number.isFinite(at) ? at <= cutoff : null, publisher_check: choice.publisher_check?.result ?? null, malicious: choice.malicious ?? null, skipped: choice.skipped.length } : { smallest_usable: true };
    } catch (error) { result.main_next_fix = { error: String(error).slice(0, 300) }; }
  }
  out.push(result);
  console.log(`${index + 1}/${rows.length} done`);
}

// ---- The summary. ----
const stoppedRows = out.filter(r => r.stopped);
const count = list => { const m = {}; for (const x of list) m[x] = (m[x] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))); };
const bySignal = list => Object.fromEntries([...new Set(list.flatMap(r => r.signals))].sort().map(s => [s, { fires: list.filter(r => r.signals.includes(s)).length, alone: list.filter(r => r.signals.length === 1 && r.signals[0] === s).length }]));
const kinds = list => { const c = { K: 0, L: 0, U: 0 }; for (const r of list) c[r.deprecation.kind]++; return { ...c, known_at_cutoff: [c.K, c.K + c.U], only_today: [c.L, c.L + c.U], widest_known_at_cutoff: [c.K, c.K + c.L + c.U] }; };
const deprecated = stoppedRows.filter(r => r.deprecation);
const funnel = reading => {
  const still = stoppedRows.filter(r => r.readings[reading].stopped_as_is), c = still.map(r => r.readings[reading].candidate);
  const found = c.filter(x => !x.none);
  return {
    stopped_as_is: still.length, passes_as_is: stoppedRows.length - still.length,
    no_candidate: count(c.filter(x => x.none).map(x => x.none)),
    candidates: found.length, publisher_check_passes: found.filter(x => x.publisher_check !== "stop").length, gates_pass: found.filter(x => x.gates_pass).length,
    passes: found.filter(x => x.passes).length,
    passes_without_the_publisher_check: found.filter(x => x.gates_pass).length,
    candidate_stop_signals: count(found.filter(x => !x.gates_pass).flatMap(x => x.signals)),
    passed_over: count(c.flatMap(x => x.passed_over.map(p => p.reason))),
    final_stopped_of_all: out.filter(r => r.readings?.[reading]?.final_stopped).length,
    in_next_fix_limits_of_passes: found.filter(x => x.passes && x.in_next_fix_limits).length,
  };
};
const URG = ["exploited", "high", "normal", "low"];
const delay = pick => Object.fromEntries(URG.map(u => {
  const members = out.filter(r => pick(r).urgency === u), d = members.map(r => pick(r).added_delay_hours).filter(x => x !== null && x !== undefined).sort((a, b) => a - b);
  return [u, { rows: members.length, n: d.length, median: d[Math.floor(d.length / 2)] ?? null, p90: d[Math.floor(d.length * 0.9)] ?? null }];
}));
const mainView = r => ({ urgency: r.urgency, added_delay_hours: r.added_delay_hours, extended: r.extended });
const redrawn = r => { const c = r.readings?.A?.candidate; return c?.passes ? { urgency: c.urgency, added_delay_hours: c.added_delay_hours, extended: c.extended } : mainView(r); };
const summaryOut = {
  sample: out.length, started_at: startedAt, finished_at: new Date().toISOString(), commit: process.env.LC3_COMMIT ?? null, node: process.version,
  epss_dates: [...new Set(out.flatMap(r => r.fixes.map(f => f.epss_date)).filter(x => x !== undefined))],
  stopped: stoppedRows.length, by_verdict: count(out.map(r => r.verdict)), by_urgency: count(out.map(r => r.urgency)),
  stops_by_signal: bySignal(stoppedRows), rule1_trees_with_unknown_branch: out.filter(r => r.rule1_unknown > 0).length,
  v4_stopped: out.filter(r => r.v4.verdict === "stop").length,
  changed_from_v4: out.filter(r => (r.v4.verdict === "stop") !== r.stopped || JSON.stringify(r.v4.signals) !== JSON.stringify(r.signals)).map(r => ({ row: `${r.name}@${r.to}`, id: r.id, v4: r.v4.signals, main: r.signals, v4_verdict: r.v4.verdict, main_verdict: r.verdict })),
  urgency_changed_from_v4: out.filter(r => r.v4.urgency !== r.urgency).length,
  registry_time_differs: out.filter(r => r.registry_time_differs).length,
  deprecation: { all: kinds(deprecated), alone: kinds(deprecated.filter(r => r.signals.length === 1)) },
  readings: { A: funnel("A"), B: funnel("B"), C: funnel("C") },
  main_next_fix: {
    smallest_usable: stoppedRows.filter(r => r.main_next_fix?.smallest_usable).length, error: stoppedRows.filter(r => r.main_next_fix?.error).length,
    chooses_a_version: stoppedRows.filter(r => r.main_next_fix?.chosen).length, chosen_within_cutoff: stoppedRows.filter(r => r.main_next_fix?.within_cutoff === true).length,
    chooses_none: stoppedRows.filter(r => r.main_next_fix && !r.main_next_fix.smallest_usable && !r.main_next_fix.error && !r.main_next_fix.chosen).length,
    publisher_check_stops: stoppedRows.filter(r => r.main_next_fix?.publisher_check === "stop").length,
  },
  delay: { main: delay(mainView), reading_a: delay(redrawn), share_extended_main: out.filter(r => r.extended).length, share_extended_reading_a: out.filter(r => redrawn(r).extended).length },
  requests: stats,
};
save(outFile, `${JSON.stringify({ summary: summaryOut, rows: out }, null, 1)}\n`);
console.log(JSON.stringify(summaryOut, null, 1));
