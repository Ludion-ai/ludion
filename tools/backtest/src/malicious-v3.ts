// Backtest v3, malicious releases (docs/decisions.md, "Backtest v3: definitions fixed before running it").
// The rerun's 1,148 malicious versions, against real security fixes: for each npm GHSA fixed version A@x, published at
// T, Ludion's resolution with the time cap is reproduced (A@x's production tree as of T, each requirement on the
// highest non-prerelease version published before T), and a malicious version V of P counts as selected when a
// requirement on P in that tree resolves to it: (a) P not in the lockfile, (b) P locked at prev (kept when it satisfies).
// The change carrying A@x and P@V is judged at T + w; V is missed when some fix selects it and nothing stops it by then.
//
// Usage: node tools/backtest/src/malicious-v3.ts <osv-npm-dir> <malicious-v2.json> <cache-dir> <out.json> [--plan]
// Reads untrusted JSON only; runs nothing from it. Network: registry.npmjs.org and api.deps.dev, read-only, cached.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { EXPLOITED_UNCOMPARABLE_HOURS, EXTENDED_MIN_HOURS, installScripts, WAIT_HOURS, type Urgency } from "../../../packages/cli/src/security/judge.ts";
import { firstPublish } from "../../../packages/cli/src/security/time-cap.ts";

const [osvDir, v2File, cacheDir, outFile, flag] = process.argv.slice(2);
if (!osvDir || !v2File || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/malicious-v3.ts <osv-npm-dir> <malicious-v2.json> <cache-dir> <out.json> [--plan]");
mkdirSync(join(cacheDir, "registry"), { recursive: true }); mkdirSync(join(cacheDir, "depsdev"), { recursive: true });

type V2Row = { id: string; name: string; version: string; published: string; previous: string; present: boolean; previous_present: boolean; hours_to_mal: number; hours_to_mal_conservative: number; provenance_regression: boolean; install_scripts_added: boolean; extends: string[]; comparable: boolean };
const rows: V2Row[] = JSON.parse(readFileSync(v2File, "utf8")).rows;
const watched = new Set(rows.map(r => r.name));

// --- Registry documents, compacted: publish times, and per version the requirements the tree walk needs. ---
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

// Which fixes can matter: T in (p, record - smallest wait) for some V.
const minWait = (r: V2Row) => Math.min(...URGENCIES.flatMap(u => (["a", "b"] as const).map(s => wait(r, u, s))));
const windows = rows.map(r => ({ r, from: Date.parse(r.published), to: record(r, "conservative") - minWait(r) * H }));
const inWindow = fixes.filter(f => windows.some(w => f.t > w.from && f.t < w.to));
const afterAny = fixes.filter(f => rows.some(r => f.t > Date.parse(r.published)));
console.log(`fixes with a registry time: ${fixes.length}; in some V's window: ${inWindow.length}; published after some V: ${afterAny.length}`);
if (flag === "--plan") process.exit(0);

// --- Ludion's resolution of A@x as of T. ---
type Tree = { stoppedByRule1: string[]; unknown: string[]; ranges: Map<string, string[]>; nodes: number };
/**
 * The highest version satisfying a range among those published before t. For each (package, range): the satisfying
 * versions in publish order with the running highest, so a query is a binary search.
 */
const ladders = new Map<string, { times: number[]; best: string[] }>();
function highestBefore(name: string, d: Doc, range: string, t: number): string | null {
  const key = `${name}\0${range}`;
  let ladder = ladders.get(key);
  if (!ladder) {
    // Every version published, including those the registry has since removed: they could be installed at the time.
    const satisfying = Object.keys(d.time).filter(v => Number.isFinite(Date.parse(d.time[v] ?? "")) && semver.satisfies(v, range)).map(v => ({ v, t: Date.parse(d.time[v]!) })).sort((a, b) => a.t - b.t);
    ladder = { times: [], best: [] };
    for (const { v, t: at } of satisfying) { const top = ladder.best.at(-1); ladder.times.push(at); ladder.best.push(top && semver.gt(top, v) ? top : v); }
    ladders.set(key, ladder);
  }
  let lo = 0, hi = ladder.times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ladder.times[mid]! < t) lo = mid + 1; else hi = mid; }
  return lo ? ladder.best[lo - 1]! : null;
}
function parseSpec(name: string, spec: string): { name: string; range: string } | "skip" | null {
  const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@(.*))?$/.exec(spec);
  if (alias) return { name: alias[1]!, range: alias[2] || "*" };
  if (/^(?:git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:|workspace:)|^[^@\s]+\/[^@\s]+(?:#.*)?$/.test(spec)) return "skip";
  if (spec === "" || spec === "latest") return { name, range: "*" };
  return semver.validRange(spec) ? { name, range: spec } : null;
}
async function resolveTree(fix: Fix): Promise<Tree> {
  const tree: Tree = { stoppedByRule1: [], unknown: [], ranges: new Map(), nodes: 0 };
  const seen = new Set<string>();
  let frontier: { name: string; version: string }[] = [{ name: fix.name, version: fix.version }];
  while (frontier.length) {
    await pool([...new Set(frontier.map(n => n.name))], 16, name => doc(name));
    const next: { name: string; version: string }[] = [], queued = new Set<string>();
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
        if (watched.has(parsed.name)) tree.ranges.set(parsed.name, [...(tree.ranges.get(parsed.name) ?? []), parsed.range]);
        if (!queued.has(`${parsed.name}\0${parsed.range}`)) { queued.add(`${parsed.name}\0${parsed.range}`); next.push({ name: parsed.name, version: `\0${parsed.range}` }); }
      }
    }
    // Resolve the next level's ranges as of T.
    frontier = [];
    await pool([...new Set(next.map(n => n.name))], 16, name => doc(name));
    for (const n of next) {
      const d = await doc(n.name), range = n.version.slice(1);
      if (d === null || d === "error") { tree.unknown.push(`${n.name}@${range}`); continue; }
      const chosen = highestBefore(n.name, d, range, fix.t);
      if (!chosen) { tree.stoppedByRule1.push(`${n.name}@${range}`); continue; }
      if (!seen.has(`${n.name}@${chosen}`)) frontier.push({ name: n.name, version: chosen });
    }
    if (tree.nodes > 20_000) { tree.unknown.push("tree larger than 20,000 versions"); break; }
  }
  return tree;
}

/** Does a fix's tree (its requirements on watched packages) select V, per scenario? */
function selects(ranges: Map<string, string[]>, r: V2Row, t: number, s: Scenario): boolean {
  const d = cached.get(r.name), wanted = ranges.get(r.name);
  if (!d || !wanted) return false;
  return wanted.some(range => !(s === "b" && semver.satisfies(r.previous, range)) && highestBefore(r.name, d, range, t) === r.version);
}

// Resolve every fix published after some V (listing), in time order; cache the per-fix outcome only.
type FixResult = { fix: Fix; stopped: boolean; unknown: boolean; watched: Map<string, string[]>; nodes: number };
const results: FixResult[] = [];
let resolved = 0;
const started = Date.now();
// --limit=N resolves only the first N (a smoke test of the script; its output is not a result).
const toResolve = flag?.startsWith("--limit=") ? afterAny.slice(-Number(flag.slice(8))) : afterAny;
await pool(toResolve, 6, async fix => {
  const tree = await resolveTree(fix);
  results.push({ fix, stopped: tree.stoppedByRule1.length > 0, unknown: tree.unknown.length > 0, watched: tree.ranges, nodes: tree.nodes });
  if (++resolved % 100 === 0) console.log(`trees ${resolved}/${toResolve.length} (${Math.round((Date.now() - started) / 60000)} min, ${memo.size} packages)`);
});
results.sort((a, b) => a.fix.t - b.fix.t);

// --- Outcomes. ---
type Outcome = "stopped" | "missed" | "unknown";
const TIMINGS = ["conservative", "optimistic"] as const;
const out = rows.map(r => {
  const p = Date.parse(r.published);
  const later = results.filter(x => x.fix.t > p && x.fix.name !== r.name);
  const sel = (s: Scenario) => later.filter(x => !x.stopped && selects(x.watched, r, x.fix.t, s));
  const selectedBy = { a: sel("a"), b: sel("b") };
  const stoppedOnlyByRule1 = { a: later.filter(x => x.stopped && selects(x.watched, r, x.fix.t, "a")).length, b: later.filter(x => x.stopped && selects(x.watched, r, x.fix.t, "b")).length };
  // Rule 2 on P: its first publish later than T minus the base wait (computed; see rule2_note).
  const created = Date.parse(cached.get(r.name)?.created ?? "");
  const young = (t: number, u: Urgency) => !Number.isFinite(created) || created > t - WAIT_HOURS[u] * H;
  const outcome = (u: Urgency, s: Scenario, timing: typeof TIMINGS[number]): Outcome => {
    const w = wait(r, u, s), end = record(r, timing) - w * H;
    if (otherStop(r, s).length) return "stopped";
    if (selectedBy[s].some(x => x.fix.t < end && !young(x.fix.t, u))) return "missed";
    if (later.some(x => x.fix.t < end && x.unknown && !x.stopped)) return "unknown";
    return "stopped";
  };
  const per = Object.fromEntries(URGENCIES.map(u => [u, Object.fromEntries(TIMINGS.map(timing => {
    const a = outcome(u, "a", timing), b = outcome(u, "b", timing);
    return [timing, { a, b, primary: a === "missed" || b === "missed" ? "missed" : a === "unknown" || b === "unknown" ? "unknown" : "stopped" }];
  }))]));
  const f = facts.get(`${r.name}@${r.version}`)!;
  const first = (s: Scenario) => selectedBy[s][0] ? { fix: `${selectedBy[s][0]!.fix.name}@${selectedBy[s][0]!.fix.version}`, advisory: selectedBy[s][0]!.fix.id, t: new Date(selectedBy[s][0]!.fix.t).toISOString(), hours_after_v: Math.round((selectedBy[s][0]!.fix.t - p) / H * 10) / 10 } : null;
  return {
    id: r.id, name: r.name, version: r.version, published: r.published, previous: r.previous, present: r.present,
    record_hours: { conservative: r.hours_to_mal_conservative, optimistic: r.hours_to_mal },
    selecting_fixes: { a: selectedBy.a.length, b: selectedBy.b.length }, first_selecting_fix: { a: first("a"), b: first("b") },
    selections_stopped_by_rule1: stoppedOnlyByRule1,
    facts: f, other_stops: { a: otherStop(r, "a"), b: otherStop(r, "b") },
    outcome: per,
  };
});

const count = (u: Urgency, timing: typeof TIMINGS[number], key: "a" | "b" | "primary", o: Outcome) => out.filter(x => (x.outcome as any)[u][timing][key] === o).length;
const byUrgency = Object.fromEntries(URGENCIES.map(u => [u, Object.fromEntries(TIMINGS.map(timing => [timing, Object.fromEntries((["primary", "a", "b"] as const).map(k => [k, { stopped: count(u, timing, k, "stopped"), missed: count(u, timing, k, "missed"), unknown: count(u, timing, k, "unknown") }]))]))]));
const sources = (key: keyof Facts) => out.reduce((m, x) => { const s = (x.facts[key] as any).source; m[s] = (m[s] ?? 0) + 1; return m; }, {} as Record<string, number>);
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/src/malicious-v3.ts and docs/decisions.md, \"Backtest v3: definitions fixed before running it\".",
  denominator: rows.length,
  fixes: { events: fixEvents.size, with_registry_time: fixes.length, left_out: fixesLeftOut, in_some_window: inWindow.length, resolved: results.length,
    resolved_stopped_by_rule1: results.filter(x => x.stopped).length, resolved_with_unknown_branch: results.filter(x => x.unknown).length,
    tree_versions: { median: results.map(x => x.nodes).sort((a, b) => a - b)[Math.floor(results.length / 2)] ?? null, max: Math.max(0, ...results.map(x => x.nodes)) } },
  by_urgency: byUrgency,
  gate_every_malicious_version_stopped: URGENCIES.every(u => byUrgency[u]!.conservative!.primary!.stopped === rows.length) ? "met" : "not met",
  signal_sources: { provenance: sources("provenance"), new_dependencies: sources("newDeps"), install_scripts: sources("scripts"), publisher: sources("publisher") },
  signal_fires: {
    provenance_regression: out.filter(x => x.facts.provenance.regression).length,
    new_dependencies: out.filter(x => x.facts.newDeps.added).length,
    install_scripts_added: out.filter(x => x.facts.scripts.added).length,
    publisher_changed: out.filter(x => x.facts.publisher.changed).length,
    rule2_could_fire_on_p: out.filter(x => { const c = Date.parse(cached.get(x.name)?.created ?? ""); return !Number.isFinite(c) || c > Date.parse(x.published) - 7 * 24 * H; }).length,
  },
  rule2_note: "Rule 2 cannot fire on P: every P in the denominator has a legitimate version at least 7 days before V, and the longest base wait is 168h.",
  selected_by_a_later_fix: out.filter(x => x.selecting_fixes.a + x.selecting_fixes.b > 0).length,
  rows: out,
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify(shown, null, 2));
