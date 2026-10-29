// The shadow's replay: condition (b), counted as docs/decisions/2026-10-29-shadow-counting.md fixes it (design:
// docs/bench/2026-10-28-shadow-design/README.md, sections 2.5 to 2.7). It reads the recorder's store and nothing else
// about versions: every fact the judge gets is a capture taken before the moment of the judgement. The judge is the
// judge's own `judge()`, imported unchanged; the run script checks that its files equal the recorder's start commit's.
// The disputed check (disputed.ts) is the only part that reads the network, and only for MAL-named versions.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { judge, registryTarball, installScripts, type Change, type FixedAdvisory, type Judgement, type Urgency, type VersionFacts } from "../../../packages/cli/src/security/judge.ts";
import { provenanceFrom } from "../../../packages/cli/src/security/npm-facts.ts";
import { firstPublish } from "../../../packages/cli/src/security/time-cap.ts";
import { names } from "../../backtest/src/archives-v5.ts";
import { categorize, networkSources, type Category, type Sources } from "./disputed.ts";

type Rec = Record<string, any>;
const HOUR = 3_600_000, DAY = 24 * HOUR;
/** The four weeks, and the longest wait in the table (low 168h, extended to max(2 × 168h, 72h)) after them. */
export const WINDOW_MS = 28 * DAY;
export const LATE_RECORD_MS = 336 * HOUR;
/** The last OSV read must be this long after the window's end + 336h: a record published by then may be imported later. */
export const OSV_MARGIN_MS = 24 * HOUR;
export const ROWS: Urgency[] = ["exploited", "high", "normal", "low"];
export const SYNTHETIC_FIX_ID = "SHADOW-SYNTHETIC-FIX";
const ms = (iso: unknown) => (typeof iso === "string" ? Date.parse(iso) : NaN);
const iso = (t: number) => new Date(t).toISOString();
const dayOf = (t: number) => iso(t).slice(0, 10);

// --- The store (docs/bench/2026-10-29-shadow-recorder/README.md, "Data layout"). ---

/** One stored version capture, reduced to what the replay reads. */
export type VersionCapture = {
  fetched_at: number; reason: string;
  publisher: string | null; shared_publisher: boolean; install_scripts: string[]; dependencies: string[];
  integrity: string | null; shasum: string | null; unpacked_size: number | null; deprecated: string | null;
  /** Provenance from the stored attestations, or why it is missing (a gap) or unreadable (a judge error). */
  provenance: { ok: VersionFacts["provenance"] } | { gap: string } | { error: string };
  files: [string, number, string][] | null; files_status: string | null;
  /** filesDigest of the hashed file list, kept for every version even when the list itself is not (keepFiles). */
  files_digest: string | null;
};
export type Store = {
  /** Per name, in capture order: baseline, change and gone records. */
  timeline: Map<string, Rec[]>;
  versions: Map<string, VersionCapture[]>;
  deprecations: Map<string, { fetched_at: number; deprecated: string | null }[]>;
  created: Map<string, { fetched_at: number; created: string | null; status: number | null }[]>;
  gaveUp: Rec[];
  /** Per OSV id, its stored copies in fetch order. */
  osv: Map<string, Rec[]>;
  osvGaveUp: Rec[];
  status: Rec[];
  duplicates: number;
};

/** A file list's digest: sha256 of its sorted (path, sha256) pairs. The disputed check compares it when the list was not kept. */
export const filesDigest = (pairs: [string, string][]) => createHash("sha256").update(JSON.stringify([...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)))).digest("hex");
const contentKey = (r: Rec) => createHash("sha256").update(JSON.stringify({ ...r, fetched_at: undefined })).digest("hex");
const streamKey = (r: Rec) => `${r.type}\0${r.name ?? r.id}\0${r.version ?? ""}`;
/**
 * Each record under `dir`, one file in memory at a time. A last line with no newline is still being appended (or was cut
 * by a copy): it is skipped.
 */
function eachLine(dir: string, fn: (r: Rec) => void) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter(f => f.endsWith(".jsonl")).sort()) {
    const text = readFileSync(join(dir, file), "utf8");
    for (let from = 0, nl = text.indexOf("\n"); nl >= 0; from = nl + 1, nl = text.indexOf("\n", from)) {
      const line = text.slice(from, nl);
      if (line.trim()) fn(JSON.parse(line));
    }
  }
}
function lines(dir: string): Rec[] { const out: Rec[] = []; eachLine(dir, r => out.push(r)); return out; }

/** The provenance the live judge would read from a stored attestations answer (npm-facts.ts, registryFacts). */
function provenanceOf(name: string, version: string, manifest: Rec, attestations: Rec | null): VersionCapture["provenance"] {
  if (!manifest?.dist?.attestations) return { ok: null };
  if (!attestations || attestations.status !== 200 || !attestations.body) return { gap: `attestations listed by the manifest were not captured (${attestations ? `status ${attestations.status}` : "no read"})` };
  try { return { ok: provenanceFrom(attestations.body, { name, version, integrity: typeof manifest.dist.integrity === "string" ? manifest.dist.integrity : null }) }; }
  catch (e) { return { error: String((e as Error).message).slice(0, 300) }; }
}

/**
 * Read the store. Records repeated by a crash between an append and the known/ write are dropped: a record equal, apart
 * from `fetched_at`, to the one before it of the same type, name and version (the first copy is kept). Only the one
 * before it, so that a value that changes and changes back (a deprecation, a 404) is kept. File lists are kept only for
 * `keepFiles` names.
 */
export function readStore(dir: string, keepFiles: (name: string) => boolean = () => true): Store {
  const store: Store = { timeline: new Map(), versions: new Map(), deprecations: new Map(), created: new Map(), gaveUp: [], osv: new Map(), osvGaveUp: [], status: lines(join(dir, "status")), duplicates: 0 };
  const previous = new Map<string, string>();
  const push = <T>(map: Map<string, T[]>, key: string, value: T) => { const list = map.get(key) ?? []; list.push(value); map.set(key, list); };
  // Each record is reduced as it is read (manifests and attestation bundles are not kept), so the store's size on disk
  // is not held in memory at once. What is kept per record: its content hash, its stream and the reduced value.
  type Item = { at: number; i: number; key: string; stream: string; apply: () => void };
  const items: Item[] = [];
  let i = 0;
  eachLine(join(dir, "captures"), r => {
    const at = ms(r.fetched_at), key = contentKey(r), stream = streamKey(r);
    let apply: () => void = () => {};
    if (r.type === "baseline" || r.type === "change" || r.type === "gone") { const t = { type: r.type, name: r.name, at, time: r.time ?? {}, removed: r.removed ?? [] }; apply = () => push(store.timeline, t.name, t); }
    else if (r.type === "version") {
      const m = r.manifest ?? {};
      const v: VersionCapture = {
        fetched_at: at, reason: r.reason,
        publisher: typeof m._npmUser?.name === "string" ? m._npmUser.name : null, shared_publisher: !!r.shared_publisher,
        install_scripts: installScripts(m.scripts), dependencies: Object.keys({ ...m.dependencies, ...m.optionalDependencies }).sort(),
        integrity: typeof m.dist?.integrity === "string" ? m.dist.integrity : null, shasum: typeof m.dist?.shasum === "string" ? m.dist.shasum : null,
        unpacked_size: typeof m.dist?.unpackedSize === "number" ? m.dist.unpackedSize : null,
        deprecated: typeof m.deprecated === "string" && m.deprecated ? m.deprecated : null,
        provenance: provenanceOf(r.name, r.version, m, r.attestations ?? null),
        files: r.files?.status === "hashed" && keepFiles(r.name) ? r.files.files : null, files_status: r.files?.status ?? null,
        files_digest: r.files?.status === "hashed" && Array.isArray(r.files.files) ? filesDigest(r.files.files.map((x: [string, number, string]) => [x[0], x[2]])) : null,
      };
      const k = `${r.name}@${r.version}`;
      apply = () => push(store.versions, k, v);
    } else if (r.type === "deprecation") { const k = `${r.name}@${r.version}`, d = { fetched_at: at, deprecated: r.deprecated ?? null }; apply = () => push(store.deprecations, k, d); }
    else if (r.type === "created") { const c = { fetched_at: at, created: r.created ?? null, status: r.status ?? null }; apply = () => push(store.created, r.name, c); }
    else if (r.type === "gave_up") apply = () => store.gaveUp.push(r);
    items.push({ at, i: i++, key, stream, apply });
  });
  items.sort((a, b) => a.at - b.at || a.i - b.i);
  for (const item of items) {
    if (previous.get(item.stream) === item.key) { store.duplicates++; continue; }
    previous.set(item.stream, item.key);
    item.apply();
  }
  const osvSeen = new Set<string>();
  for (const r of lines(join(dir, "osv")).sort((a, b) => ms(a.fetched_at) - ms(b.fetched_at))) {
    if (r.type === "gave_up") { store.osvGaveUp.push(r); continue; }
    if (r.type !== "osv" || typeof r.id !== "string") continue;
    const key = `${r.id}\0${r.sha256}`;
    if (osvSeen.has(key)) { store.duplicates++; continue; }
    osvSeen.add(key);
    push(store.osv, r.id, r);
  }
  return store;
}

/** The packument's `time`, which versions are no longer listed, and whether the package is gone, as of `cutoff`. */
export function timeAt(store: Store, name: string, cutoff: number): { time: Record<string, string>; removed: Set<string>; gone: boolean } | null {
  let time: Record<string, string> | null = null, gone = false;
  const removed = new Set<string>();
  for (const r of store.timeline.get(name) ?? []) {
    if (r.at > cutoff) break;
    if (r.type === "gone") { gone = true; continue; }
    gone = false;
    if (r.type === "baseline") time = { ...r.time };
    else { time = { ...(time ?? {}), ...r.time }; for (const v of r.removed ?? []) removed.add(v); }
  }
  return time ? { time, removed, gone } : null;
}
/** Every version a stored `time` ever named, with its latest publish time. */
export function allVersions(store: Store, name: string, cutoff = Infinity): Map<string, string> {
  const t = timeAt(store, name, cutoff);
  return new Map(Object.entries(t?.time ?? {}).filter(([v]) => semver.valid(v)));
}
const latestBefore = <T extends { fetched_at: number }>(list: T[] | undefined, cutoff: number) => { let out: T | undefined; for (const x of list ?? []) if (x.fetched_at <= cutoff) out = x; return out; };

// --- OSV: the MAL- records the store holds. ---

/** Every stored copy of every MAL- record, in fetch order. */
export function malCopies(store: Store): Rec[] {
  return [...store.osv.values()].flatMap(copies => copies.map(c => c.record)).filter(r => typeof r?.id === "string" && r.id.startsWith("MAL-"));
}
/**
 * OSV records whose read failed and is still being retried: an `error` status line naming the id, with no stored copy
 * fetched after it and no give-up. What they name is not known yet.
 */
export function osvRetrying(store: Store): string[] {
  const out = new Set<string>();
  for (const s of store.status) {
    if (s.type !== "error" || typeof s.id !== "string") continue;
    const after = (store.osv.get(s.id) ?? []).some(c => ms(c.fetched_at) > ms(s.at)) || store.osvGaveUp.some(g => g.id === s.id && ms(g.fetched_at) > ms(s.at));
    if (after) out.delete(s.id); else out.add(s.id);
  }
  return [...out].sort();
}
const withdrawnBy = (r: Rec, t: number) => Number.isFinite(ms(r.withdrawn)) && ms(r.withdrawn) <= t;
/**
 * Ids of MAL- records naming name@version at `t` (the re-query at the wait's end): each record as its latest stored copy
 * modified by `t` says, published by `t` and not withdrawn by then. A record with no stored copy modified by `t` is not
 * known to have named it then, so it does not stop it (the stricter side: a miss).
 */
export function malNaming(store: Store, name: string, version: string, t: number): string[] {
  const out: string[] = [];
  for (const [id, copies] of store.osv) {
    if (!id.startsWith("MAL-")) continue;
    let r: Rec | undefined, at = -Infinity;
    for (const c of copies) { const m = ms(c.record?.modified ?? c.modified); if (m <= t && m >= at) { r = c.record; at = m; } }
    if (r && ms(r.published) <= t && !withdrawnBy(r, t) && names(r, name, version)) out.push(id);
  }
  return out.sort();
}

// --- The four weeks (section 2). ---

export type Window = {
  /** Each run of consecutive days with a successful poll: its start, and the day without one that ended it. */
  runs: { start: string; broken_by: string | null }[];
  /** The first run that lasted four weeks, else the current run. */
  start: string | null; end: string | null;
  state: "not_started" | "in_progress" | "complete";
};
/**
 * A successful poll is a `poll` status line. The four weeks start at the first one; a UTC calendar day with none ends
 * the run, and the next run starts at the next successful poll. Only days before `asOf`'s day are judged complete.
 */
export function windowOf(status: Rec[], asOf: number): Window {
  const polls = status.filter(s => s.type === "poll").map(s => ms(s.at)).filter(t => Number.isFinite(t) && t <= asOf).sort((a, b) => a - b);
  const days = new Set(polls.map(dayOf));
  const runs: Window["runs"] = [];
  if (!polls.length) return { runs, start: null, end: null, state: "not_started" };
  let start = polls[0]!;
  const today = dayOf(asOf);
  for (let d = Date.parse(`${dayOf(start)}T00:00:00.000Z`) + DAY; dayOf(d) < today; d += DAY) {
    if (start + WINDOW_MS <= d) break;
    if (days.has(dayOf(d))) continue;
    runs.push({ start: iso(start), broken_by: dayOf(d) });
    const next = polls.find(t => t >= d + DAY);
    if (next === undefined) return { runs, start: null, end: null, state: "not_started" };
    start = next;
    d = Date.parse(`${dayOf(start)}T00:00:00.000Z`);
  }
  runs.push({ start: iso(start), broken_by: null });
  const end = start + WINDOW_MS;
  return { runs, start: iso(start), end: iso(end), state: asOf >= end && dayOf(asOf) > dayOf(end - 1) ? "complete" : "in_progress" };
}

// --- One judgement (section 4). ---

export type Scenario = "b" | "a" | "literal";
export type Outcome = "stopped" | "missed" | "capture_gap" | "pending" | "not_applicable";
export type RowResult = {
  scenario: Scenario; row: Urgency | null; prev: string | null; outcome: Outcome;
  verdict?: Judgement["verdict"]; urgency?: Urgency; wait_hours?: number; wait_until?: string | null; judged_at?: string;
  stops?: string[]; gap?: string; iterations?: number;
};
type Ctx = { store: Store; watched: Map<string, string[]>; coverage: number };

/** VersionFacts for name@version from captures taken by `cutoff`, or why the replay cannot have them. */
function factsAt(ctx: Ctx, name: string, version: string, cutoff: number): { facts: VersionFacts; error?: string } | { gap: string } {
  const t = timeAt(ctx.store, name, cutoff);
  const cap = latestBefore(ctx.store.versions.get(`${name}@${version}`), cutoff);
  const published = t?.time[version] ?? null;
  const present = !!t && !t.gone && !t.removed.has(version);
  const malicious = malNaming(ctx.store, name, version, cutoff);
  if (!cap) {
    // Not listed and never captured: the registry keeps only its publish time, as the live judge would read it.
    if (t && !present && published) return { facts: { published_at: published, present: false, deprecated: null, publisher: null, shared_publisher: false, provenance: null, install_scripts: [], dependencies: [], integrity: null, package_created: firstPublish(t.time), malicious, advisories: [] } };
    return { gap: `${name}@${version} was not captured by ${iso(cutoff)}` };
  }
  if (!published) return { gap: `${name}@${version} has no captured publish time by ${iso(cutoff)}` };
  if ("gap" in cap.provenance) return { gap: `${name}@${version}: ${cap.provenance.gap}` };
  const dep = latestBefore(ctx.store.deprecations.get(`${name}@${version}`), cutoff);
  return {
    facts: {
      published_at: published, present, deprecated: dep ? dep.deprecated : cap.deprecated,
      publisher: cap.publisher, shared_publisher: cap.shared_publisher,
      provenance: "ok" in cap.provenance ? cap.provenance.ok : null,
      install_scripts: cap.install_scripts, dependencies: cap.dependencies, integrity: cap.integrity,
      package_created: t ? firstPublish(t.time) : null, malicious, advisories: [],
    },
    ...("error" in cap.provenance ? { error: `${name}@${version} attestations: ${cap.provenance.error}` } : {}),
  };
}
/** Rule 2's `created` for a package from captures by `cutoff`: a `created` record, else its own stored `time`. */
function createdAt(ctx: Ctx, name: string, cutoff: number): { created: string | null } | null {
  const rec = latestBefore(ctx.store.created.get(name), cutoff);
  if (rec) return { created: rec.status === 404 ? null : rec.created };
  const t = timeAt(ctx.store, name, cutoff);
  return t ? { created: firstPublish(t.time) } : null;
}

/** The synthetic fix that sets row u's urgency (section 4): a harness input, not an advisory. */
export function syntheticFix(name: string, prev: string, version: string, row: Urgency): FixedAdvisory {
  return { id: SYNTHETIC_FIX_ID, package: name, from: prev, to: version, aliases: [], severity: row === "high" ? "CRITICAL" : null, kev: row === "exploited", epss: null };
}

/** The judge's input for one row and scenario, from captures by `cutoff`; or the capture gap that keeps it from running. */
function inputAt(ctx: Ctx, name: string, version: string, prev: string | null, row: Urgency | null, scenario: Scenario, cutoff: number): Parameters<typeof judge>[0] | { gap: string } {
  const next = factsAt(ctx, name, version, cutoff);
  if ("gap" in next) return next;
  const facts = new Map([[`${name}@${version}`, next.facts]]);
  const errors = next.error ? [next.error] : [];
  let before: VersionFacts | undefined;
  if (prev) {
    const p = factsAt(ctx, name, prev, cutoff);
    if ("gap" in p) return { gap: `predecessor: ${p.gap}` };
    facts.set(`${name}@${prev}`, p.facts);
    before = p.facts;
    if (p.error) errors.push(p.error);
  }
  const dev = scenario !== "literal" && row === "low";
  const change: Change = { path: `node_modules/${name}`, name, from: prev, to: version, dev, resolved: registryTarball(name, version), integrity: next.facts.integrity, replaced: null };
  // Rule 2 needs `created` for each new dependency (judge.ts): V's dependencies its predecessor lacks.
  const created = new Map<string, string | null>();
  for (const dep of before?.present ? next.facts.dependencies.filter(d => !before!.dependencies.includes(d)) : []) {
    const c = createdAt(ctx, dep, cutoff);
    if (!c) return { gap: `the first publish of ${dep}, a new dependency of ${name}@${version}, was not captured by ${iso(cutoff)}` };
    created.set(dep, c.created);
  }
  return {
    changes: [change], facts, created, errors,
    fixes: scenario === "b" ? [syntheticFix(name, prev!, version, row!)] : [],
    files: ["package.json", "package-lock.json"],
    now: new Date(cutoff + 1),
    locked: new Set(prev ? [`${name}@${prev}`] : []),
    ...(scenario === "b" ? {} : { direct: [name] }),
  };
}

/**
 * The end of the poll that took a capture: its status line (a poll, the error that ended the whole poll, or a stop).
 * All its records come before it. An error line naming a package or an OSV id is written mid-poll, so it is not one.
 */
const pollEnds = new WeakMap<Store, number[]>();
function pollEndAfter(ctx: Ctx, t: number): number {
  let ends = pollEnds.get(ctx.store);
  if (!ends) { ends = ctx.store.status.filter(s => s.type === "poll" || s.type === "stopped" || (s.type === "error" && s.name === undefined && s.id === undefined)).map(s => ms(s.at)).sort((a, b) => a - b); pollEnds.set(ctx.store, ends); }
  let lo = 0, hi = ends.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid]! < t) lo = mid + 1; else hi = mid; }
  // No poll has ended after it yet (a snapshot taken mid-poll): Infinity, so the judgement is pending.
  return ends[lo] ?? Infinity;
}
/** Per package name, when each of its version captures was taken (built once per store). */
const captureTimes = new WeakMap<Store, Map<string, number[]>>();
function captureTimesByName(store: Store): Map<string, number[]> {
  let byName = captureTimes.get(store);
  if (!byName) {
    byName = new Map();
    for (const [key, list] of store.versions) { const n = key.slice(0, key.lastIndexOf("@")); byName.set(n, [...(byName.get(n) ?? []), ...list.map(c => c.fetched_at)]); }
    captureTimes.set(store, byName);
  }
  return byName;
}
/**
 * The moments at which V's inputs can first be complete: the end of each poll, from V's first capture on, that stored
 * anything the judgement reads. That is a capture of V, of another version of P (its predecessor's retry, say), a
 * change to P's packument, or the first publish of one of V's dependencies.
 */
function* seedsOf(ctx: Ctx, name: string, version: string): Generator<number> {
  const own = ctx.store.versions.get(`${name}@${version}`) ?? [];
  const first = own[0]!.fetched_at;
  const deps = new Set(own.flatMap(c => c.dependencies));
  const times = [
    ...own.map(c => c.fetched_at),
    ...(ctx.store.timeline.get(name) ?? []).map(r => r.at as number),
    ...(captureTimesByName(ctx.store).get(name) ?? []),
    ...[...deps].flatMap(d => (ctx.store.created.get(d) ?? []).map(c => c.fetched_at)),
  ].filter(t => t >= first).sort((a, b) => a - b);
  let last = -Infinity;
  for (const t of times) { const end = pollEndAfter(ctx, t); if (end > last) { last = end; yield end; } }
}
/**
 * One row of one scenario, judged at the judge's own wait_until: computed first from the end of the poll that first
 * captured V completely (a capture whose sub-reads failed is retried by the recorder; the first with every input is
 * V's first capture), then again from the facts as of that moment until it no longer moves. `now` is 1 ms after it.
 */
export function judgeRow(ctx: Ctx, name: string, version: string, prev: string | null, row: Urgency | null, scenario: Scenario): RowResult {
  const base: RowResult = { scenario, row, prev, outcome: "capture_gap" };
  const captures = ctx.store.versions.get(`${name}@${version}`) ?? [];
  if (!captures.length) return { ...base, gap: `${name}@${version} was never captured (removed before its first capture, or lost in a gap)` };
  let input: ReturnType<typeof inputAt> = { gap: "" }, seed = NaN;
  for (const s of seedsOf(ctx, name, version)) {
    // Past the store's coverage, a later poll may still complete the inputs: pending, not a gap.
    if (s > ctx.coverage) return { ...base, outcome: "pending", gap: "inputs not complete within the store's coverage" };
    seed = s;
    input = inputAt(ctx, name, version, prev, row, scenario, seed);
    if (!("gap" in input)) break;
  }
  if ("gap" in input) return { ...base, gap: input.gap };
  let j = judge(input), at = seed, iterations = 0;
  while (j.wait_until && Date.parse(j.wait_until) !== at && iterations < 20) {
    at = Date.parse(j.wait_until);
    if (at > ctx.coverage) return { ...base, outcome: "pending", wait_until: j.wait_until };
    input = inputAt(ctx, name, version, prev, row, scenario, at);
    if ("gap" in input) return { ...base, gap: input.gap, wait_until: iso(at) };
    j = judge(input);
    iterations++;
  }
  if (j.wait_until && Date.parse(j.wait_until) !== at) return { ...base, gap: "wait_until did not settle within 20 recomputations" };
  const result: RowResult = { ...base, outcome: "stopped", verdict: j.verdict, urgency: j.urgency, wait_hours: j.wait_hours, wait_until: j.wait_until, judged_at: j.judged_at, stops: j.findings.filter(f => f.effect === "stop").map(f => f.message), iterations };
  if (j.verdict === "ready_except_build") return { ...result, outcome: "missed" };
  // A `wait` verdict at wait_until means the harness is wrong (section 5).
  if (j.verdict === "wait") return { ...result, outcome: "capture_gap", gap: "the judge answered wait at its own wait_until" };
  return result;
}

// --- Per version (sections 4 and 5). ---

/**
 * The registry's predecessor, as the recorder stored it: the latest-published version lower than V by semver and
 * published before V, among those listed when V was first captured. A version the recorder did not capture by then
 * and did not see removed was not listed (the recorder captures its predecessor with V).
 */
export function registryPredecessor(store: Store, name: string, version: string): string | null {
  const first = store.versions.get(`${name}@${version}`)?.[0]?.fetched_at;
  const t = timeAt(store, name, first ?? Infinity);
  const at = t?.time[version];
  if (!t || !at || !semver.valid(version)) return null;
  const pollEnd = (store.status.filter(s => s.type === "poll" && ms(s.at) >= (first ?? Infinity)).map(s => ms(s.at)).sort((a, b) => a - b)[0]) ?? Infinity;
  const candidates = Object.keys(t.time).filter(v => semver.valid(v) && semver.lt(v, version) && ms(t.time[v]) < ms(at) && !t.removed.has(v) && (store.versions.get(`${name}@${v}`)?.[0]?.fetched_at ?? Infinity) <= pollEnd);
  return candidates.sort((a, b) => ms(t.time[b]) - ms(t.time[a]))[0] ?? null;
}
/** Section 4's prevs for (b): each distinct watched-lockfile version below V, else the registry's predecessor. */
export function prevsOf(ctx: Ctx, name: string, version: string): string[] {
  const locked = (ctx.watched.get(name) ?? []).filter(v => semver.valid(v) && semver.valid(version) && semver.lt(v, version));
  if (locked.length) return [...new Set(locked)].sort(semver.rcompare);
  const p = registryPredecessor(ctx.store, name, version);
  return p ? [p] : [];
}

export type VersionResult = {
  name: string; version: string; published: string | null; first_capture: string | null; capture_lag_hours: number | null;
  /** The decided count's prev (section 7): the highest watched-lockfile version below V, else the registry's predecessor. */
  decided_prev: string | null; decided: boolean;
  rows: RowResult[];
  /** Per row, the combined outcome over every scenario and prev (section 5): missed, else gap, else pending, else stopped. */
  combined?: Record<Urgency, Outcome>;
  literal: RowResult | null;
};
const combine = (outcomes: Outcome[]): Outcome => outcomes.includes("missed") ? "missed" : outcomes.includes("capture_gap") ? "capture_gap" : outcomes.includes("pending") ? "pending" : outcomes.every(o => o === "not_applicable") ? "not_applicable" : "stopped";
const DECIDED: Judgement["verdict"][] = ["stop", "ready_except_build"];

/** Judge one version: the decided count's (b) rows and the literal verdict; with `full`, every prev and scenario (a). */
export function judgeVersion(ctx: Ctx, name: string, version: string, full: boolean): VersionResult {
  const published = allVersions(ctx.store, name).get(version) ?? null;
  const first = ctx.store.versions.get(`${name}@${version}`)?.find(c => c.reason === "new")?.fetched_at ?? ctx.store.versions.get(`${name}@${version}`)?.[0]?.fetched_at ?? null;
  const prevs = prevsOf(ctx, name, version);
  const decidedPrev = prevs[0] ?? null;
  const rows: RowResult[] = [];
  for (const prev of full ? prevs : prevs.slice(0, 1)) for (const row of ROWS) rows.push(judgeRow(ctx, name, version, prev, row, "b"));
  // No version of P below V anywhere: section 5 counts a missing predecessor as a capture gap.
  if (!prevs.length) for (const row of ROWS) rows.push({ scenario: "b", row, prev: null, outcome: "capture_gap", gap: "a missing predecessor: no watched-lockfile version and no registry predecessor below V" });
  if (full) {
    // (a): a new package has no `from`, so only the rows the judge gives it: normal (production) and low (dev).
    for (const row of ROWS) rows.push(row === "normal" || row === "low" ? judgeRow(ctx, name, version, null, row, "a") : { scenario: "a", row, prev: null, outcome: "not_applicable" });
  }
  const decided = !!decidedPrev && ROWS.every(row => { const r = rows.find(x => x.scenario === "b" && x.prev === decidedPrev && x.row === row); return !!r?.verdict && DECIDED.includes(r.verdict) && r.outcome !== "capture_gap"; });
  // The judge's literal verdict (section 8): no fix, so its own urgency (normal, the change as production), V direct.
  const literal = judgeRow(ctx, name, version, decidedPrev, null, "literal");
  const out: VersionResult = {
    name, version, published, first_capture: first === null ? null : iso(first),
    capture_lag_hours: first !== null && published ? (first - Date.parse(published)) / HOUR : null,
    decided_prev: decidedPrev, decided, rows, literal,
  };
  if (full) out.combined = Object.fromEntries(ROWS.map(row => [row, combine(rows.filter(r => r.row === row).map(r => r.outcome))])) as Record<Urgency, Outcome>;
  return out;
}

// --- The count (sections 3, 6 and 7). ---

export type MalCase = VersionResult & { records: string[]; category: Category; category_evidence: unknown; counts_as_malicious: boolean; missed_rows: Urgency[] };
export type Report = {
  schema: 1; as_of: string; coverage: string; window: Window;
  final: boolean; not_final_because: string[];
  start_commits: string[]; watched_sha256: string[];
  versions_in_window: number; judged: number; pending: number;
  decided: { count: number; needed: 100; state: "met" | "not_met" | "not_yet" };
  misses: { count: number; state: "met" | "met_with_no_case" | "not_met" | "not_yet"; versions: string[] };
  mal: { records_naming_watched: number; versions: number; by_category: Record<Category, number>; records_by_category: Record<Category, number>; cases: MalCase[]; outside_window: { version: string; records: string[]; why: string }[] };
  capture_lag_hours: { count: number; median: number | null; p90: number | null };
  per_row: Record<string, Record<Outcome, number>>;
  capture_gaps: { version: string; scenario: Scenario; row: Urgency | null; prev: string | null; gap: string }[];
  undecidable: { version: string; scenario: Scenario; row: Urgency | null; prev: string | null; stops: string[] }[];
  literal: Record<string, number>;
  gave_up: Rec[]; osv_gave_up: Rec[]; duplicates: number;
};
const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return s[lo]! + (s[hi]! - s[lo]!) * (i - lo); };

/**
 * The replay over the whole store. `asOf` is when it runs; `coverage` is how far the store's facts reach (the last
 * successful poll and the last OSV read, whichever is earlier). A judgement whose wait_until is past it is pending.
 */
export async function replay(input: { store: Store; watched: Record<string, string[]>; asOf: number; sources: Sources | null }): Promise<Report> {
  const { store, asOf } = input;
  // A loop, not Math.max(...): months of one-a-minute polls are more arguments than a call may take.
  const latest = (type: string) => store.status.reduce((m, s) => { const t = ms(s.at); return s.type === type && t <= asOf && t > m ? t : m; }, -Infinity);
  const lastPoll = latest("poll"), lastOsv = latest("osv");
  const coverage = Math.min(lastPoll, lastOsv);
  // Every stored copy of every MAL- record: a version any copy named stays named, as a withdrawn record does.
  const copies = malCopies(store);
  const ctx: Ctx = { store, watched: new Map(Object.entries(input.watched)), coverage };
  const window = windowOf(store.status, asOf);
  const start = window.start ? ms(window.start) : NaN, end = window.end ? ms(window.end) : NaN;
  const inWindow = (published: string | null | undefined) => !!published && ms(published) >= start && ms(published) < end;
  // The recorder stores only records modified after its start, and only those OSV's export lists after its cursor. For
  // the denominator, OSV is also asked for every record naming each watched package with a version in the window
  // (package names only). The judgements' re-query still reads stored copies only.
  const osvNotQueried: string[] = [];
  if (window.start) {
    // Every watched name the feed showed changing in the window (a publish changes the packument; so does a package
    // taken down), every one whose capture failed, and every one with a stored window version.
    const failedNames = new Set([...store.status.filter(x => x.type === "error" && typeof x.name === "string").map(x => x.name), ...store.gaveUp.map(g => g.name)]);
    const withWindowVersions = [...new Set([...store.timeline.keys(), ...failedNames])].filter(n => Object.hasOwn(input.watched, n) && ((store.timeline.get(n) ?? []).some(r => r.at >= start && r.at <= asOf) || failedNames.has(n) || [...allVersions(store, n, asOf).values()].some(inWindow)));
    if (!input.sources) osvNotQueried.push(`${withWindowVersions.length} package(s) (without the network)`);
    else for (const n of withWindowVersions) {
      const answer = await input.sources.osvRecords(n);
      if (answer === "unreadable") osvNotQueried.push(n);
      else copies.push(...answer.filter(r => typeof r?.id === "string" && r.id.startsWith("MAL-")));
    }
  }
  const registryTimes = new Map<string, Promise<Record<string, string> | "unreadable">>();
  const registryTime = (name: string) => { if (!registryTimes.has(name)) registryTimes.set(name, input.sources!.registryTime(name)); return registryTimes.get(name)!; };

  // MAL- records naming a watched version (section 3): explicit versions, and every version a range covers: those in
  // the store, and with the network those in the registry's `time`. Per version, the earliest publish of a copy naming it.
  const watchedNames = new Set(Object.keys(input.watched));
  const named = new Map<string, Map<string, number>>();
  const namingIds = new Set<string>();
  const rangesNotRead = new Set<string>();
  for (const r of copies) {
    for (const a of r.affected ?? []) {
      const name = a?.package?.ecosystem === "npm" ? a.package.name : null;
      if (typeof name !== "string" || !watchedNames.has(name)) continue;
      const candidates = new Set<string>([...(Array.isArray(a.versions) ? a.versions.filter((v: unknown) => typeof v === "string") : []), ...allVersions(store, name).keys()]);
      if ((a.ranges ?? []).some((x: any) => x?.type === "SEMVER" || x?.type === "ECOSYSTEM") && ms(r.published) <= end + LATE_RECORD_MS) {
        const time = input.sources ? await registryTime(name) : "unreadable";
        if (time === "unreadable") rangesNotRead.add(`${r.id} (${name})`);
        else for (const v of Object.keys(time)) if (semver.valid(v)) candidates.add(v);
      }
      for (const v of candidates) {
        if (!names(r, name, v)) continue;
        namingIds.add(r.id);
        const ids = named.get(`${name}@${v}`) ?? new Map<string, number>();
        // A copy with no publish time cannot be shown to be late: it counts as on time (the stricter side).
        const p = ms(r.published);
        ids.set(r.id, Math.min(ids.get(r.id) ?? Infinity, Number.isFinite(p) ? p : -Infinity));
        named.set(`${name}@${v}`, ids);
      }
    }
  }
  const recordsNamingWatched = namingIds.size;

  const results: VersionResult[] = [];
  const outside: Report["mal"]["outside_window"] = [];
  const cases: MalCase[] = [];
  if (window.start) {
    for (const name of new Set([...store.timeline.keys()].filter(n => watchedNames.has(n)))) {
      for (const [version, published] of allVersions(store, name, asOf)) {
        if (!inWindow(published)) continue;
        results.push(judgeVersion(ctx, name, version, named.has(`${name}@${version}`)));
      }
    }
  }
  // MAL-named versions: in the denominator if in the window and named by a record published by the window's end + 336h.
  for (const [id, ids] of named) {
    const name = id.slice(0, id.lastIndexOf("@")), version = id.slice(id.lastIndexOf("@") + 1);
    const recs = [...ids.keys()].sort();
    // Withdrawn records, and records whose later copy no longer names V, stay: section 6 sets apart only false-report candidates.
    const due = recs.filter(r => ids.get(r)! <= end + LATE_RECORD_MS);
    if (!window.start) { outside.push({ version: id, records: recs, why: "the four weeks have not started" }); continue; }
    if (!due.length) { outside.push({ version: id, records: recs, why: "named only by records published after the window's end + 336h" }); continue; }
    let published: string | null = allVersions(store, name, asOf).get(version) ?? null;
    let result = results.find(x => x.name === name && x.version === version);
    if (!published) {
      // No stored publish time (section 3): the registry's `time` keeps it, also for a removed version. Without it the
      // version can be neither placed nor replayed: a capture gap in every row.
      const times = input.sources ? await registryTime(name) : "unreadable";
      const read = times === "unreadable" ? "unreadable" : times[version] ?? null;
      const known = read !== null && read !== "unreadable" ? read : null;
      if (known && !inWindow(known)) { outside.push({ version: id, records: due, why: `published ${known} (the registry's time), outside the window` }); continue; }
      published = known;
      const gap = known ? "never captured (its publish time is the registry's)" : `no stored publish time, and the registry's time ${read === null ? "does not hold it" : "was not read"}`;
      result = { name, version, published, first_capture: null, capture_lag_hours: null, decided_prev: null, decided: false, rows: ROWS.map(row => ({ scenario: "b" as const, row, prev: null, outcome: "capture_gap" as const, gap })), literal: null, combined: Object.fromEntries(ROWS.map(r => [r, "capture_gap"])) as Record<Urgency, Outcome> };
    } else if (!inWindow(published)) { outside.push({ version: id, records: due, why: `published ${published}, outside the window` }); continue; }
    if (!result) throw new Error(`${id} is in the window but was not judged`);
    const { category, evidence } = input.sources ? await categorize({ name, version, published, store, records: copies, sources: input.sources }) : { category: "not_checked" as Category, evidence: "the disputed check was not run (no network sources given)" };
    const missedRows = ROWS.filter(row => result.combined![row] === "missed" || result.combined![row] === "capture_gap");
    cases.push({ ...result, records: due, category, category_evidence: evidence, counts_as_malicious: category !== "false_report", missed_rows: missedRows });
  }

  const notFinal: string[] = [];
  if (window.state !== "complete") notFinal.push(window.state === "not_started" ? "the four weeks have not started" : `the four weeks run until ${window.end}`);
  if (window.end && asOf < end + LATE_RECORD_MS) notFinal.push(`MAL- records can still join the denominator until ${iso(end + LATE_RECORD_MS)} (the window's end + 336h)`);
  if (window.end && !(lastOsv >= end + LATE_RECORD_MS + OSV_MARGIN_MS)) notFinal.push(`the last OSV read (${Number.isFinite(lastOsv) ? iso(lastOsv) : "none"}) is not 24h past the window's end + 336h`);
  const pendingVersions = results.filter(r => [...r.rows, ...(r.literal ? [r.literal] : [])].some(x => x.outcome === "pending"));
  if (pendingVersions.length) notFinal.push(`${pendingVersions.length} version(s) have a judgement whose wait_until is past the store's coverage (${iso(coverage)})`);
  if (store.osvGaveUp.length) notFinal.push(`${store.osvGaveUp.length} OSV record(s) were given up unread, so what they name is unknown`);
  const retrying = osvRetrying(store);
  if (retrying.length) notFinal.push(`${retrying.length} OSV record(s) are still being read again (${retrying.slice(0, 5).join(", ")}), so what they name is unknown`);
  if (osvNotQueried.length) notFinal.push(`OSV was not asked for the records naming ${osvNotQueried.slice(0, 5).join(", ")}, so records the recorder did not store (modified before it started) are not counted`);
  if (rangesNotRead.size) notFinal.push(`record(s) name watched packages by a range, and the registry's versions were not read (without the network, or unreadable): ${[...rangesNotRead].slice(0, 5).join(", ")}`);
  const final = notFinal.length === 0;

  const counted = cases.filter(c => c.counts_as_malicious);
  const missVersions = counted.filter(c => c.missed_rows.length).map(c => `${c.name}@${c.version}`);
  const pendingMal = counted.filter(c => ROWS.some(row => c.combined![row] === "pending"));
  const decidedCount = results.filter(r => r.decided).length;
  const perRow: Report["per_row"] = {};
  const tally = (key: string, o: Outcome) => { perRow[key] ??= { stopped: 0, missed: 0, capture_gap: 0, pending: 0, not_applicable: 0 }; perRow[key]![o]++; };
  for (const r of results) for (const x of r.rows) tally(`${x.scenario}:${x.row}${x.scenario === "b" && x.prev !== r.decided_prev ? ":other_prev" : ""}`, x.outcome);
  const literal: Record<string, number> = {};
  for (const r of results) if (r.literal) { const k = r.literal.verdict ?? r.literal.outcome; literal[k] = (literal[k] ?? 0) + 1; }
  const lags = results.map(r => r.capture_lag_hours).filter((x): x is number => x !== null);
  const byCategory = { confirmed: 0, record_omission: 0, false_report: 0, not_checked: 0 } as Record<Category, number>;
  for (const c of cases) byCategory[c.category]++;
  const recordsByCategory = Object.fromEntries((Object.keys(byCategory) as Category[]).map(k => [k, new Set(cases.filter(c => c.category === k).flatMap(c => c.records)).size])) as Record<Category, number>;
  const id = (r: VersionResult) => `${r.name}@${r.version}`;
  return {
    schema: 1, as_of: iso(asOf), coverage: Number.isFinite(coverage) ? iso(coverage) : "none", window, final, not_final_because: notFinal,
    start_commits: [...new Set(store.status.filter(s => s.type === "start").map(s => String(s.commit)))],
    watched_sha256: [...new Set(store.status.filter(s => s.type === "start").map(s => String(s.watched_sha256)))],
    versions_in_window: results.length, judged: results.length - pendingVersions.length, pending: pendingVersions.length,
    decided: { count: decidedCount, needed: 100, state: decidedCount >= 100 && final ? "met" : final ? "not_met" : "not_yet" },
    misses: { count: missVersions.length, versions: missVersions, state: missVersions.length ? "not_met" : !final || pendingMal.length ? "not_yet" : cases.length ? "met" : "met_with_no_case" },
    mal: { records_naming_watched: recordsNamingWatched, versions: cases.length, by_category: byCategory, records_by_category: recordsByCategory, cases, outside_window: outside },
    capture_lag_hours: { count: lags.length, median: quantile(lags, 0.5), p90: quantile(lags, 0.9) },
    per_row: perRow,
    capture_gaps: [...results, ...cases.filter(c => !results.some(r => r.name === c.name && r.version === c.version))].flatMap(r => r.rows.filter(x => x.outcome === "capture_gap").map(x => ({ version: id(r), scenario: x.scenario, row: x.row, prev: x.prev, gap: x.gap ?? "" }))),
    undecidable: results.flatMap(r => [...r.rows, ...(r.literal ? [r.literal] : [])].filter(x => x.verdict === "undecidable").map(x => ({ version: id(r), scenario: x.scenario, row: x.row, prev: x.prev, stops: x.stops ?? [] }))),
    literal, gave_up: store.gaveUp, osv_gave_up: store.osvGaveUp, duplicates: store.duplicates,
  };
}

/** The report's headline, as plain text. */
export function renderReport(r: Report): string {
  const lines = [
    `Shadow replay as of ${r.as_of} (store coverage ${r.coverage}).`,
    `Window: ${r.window.state}${r.window.start ? `, ${r.window.start} to ${r.window.end}` : ""}; runs: ${r.window.runs.map(x => `${x.start}${x.broken_by ? ` (broken by ${x.broken_by})` : ""}`).join(", ") || "none"}.`,
    r.final ? "Final: yes." : `Final: no. ${r.not_final_because.join("; ")}.`,
    `Recorder start commit(s): ${r.start_commits.join(", ")}; watched list sha256: ${r.watched_sha256.join(", ")}.`,
    `Versions in the window: ${r.versions_in_window} (judged ${r.judged}, pending ${r.pending}).`,
    `Decided (b, one prev, stop or ready_except_build in all four rows): ${r.decided.count} of ${r.decided.needed} needed: ${r.decided.state}.`,
    `Misses (confirmed and record-omission candidates): ${r.misses.count}: ${r.misses.state}${r.misses.versions.length ? ` (${r.misses.versions.join(", ")})` : ""}.`,
    `MAL- records naming a watched version: ${r.mal.records_naming_watched}; versions in the denominator: ${r.mal.versions} (confirmed ${r.mal.by_category.confirmed}, record-omission ${r.mal.by_category.record_omission}, false-report ${r.mal.by_category.false_report}, not checked ${r.mal.by_category.not_checked}); named outside it: ${r.mal.outside_window.length}.`,
    `Capture lag: ${r.capture_lag_hours.count} versions, median ${r.capture_lag_hours.median?.toFixed(3) ?? "n/a"}h, p90 ${r.capture_lag_hours.p90?.toFixed(3) ?? "n/a"}h.`,
    `Capture gaps: ${r.capture_gaps.length} row(s); undecidable verdicts: ${r.undecidable.length}; recorder give-ups: ${r.gave_up.length}; OSV give-ups: ${r.osv_gave_up.length}; duplicate records dropped: ${r.duplicates}.`,
    "Per scenario and row:",
    ...Object.entries(r.per_row).sort().map(([k, v]) => `  ${k}: ${Object.entries(v).filter(([, n]) => n).map(([o, n]) => `${o} ${n}`).join(", ")}`),
    `Literal verdicts (normal, production, no fix): ${Object.entries(r.literal).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`,
  ];
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // node tools/shadow/src/replay.ts <data dir> <out.json> [--as-of=<ISO time>] [--cache=<dir>]
  // Without --cache, the disputed check is not run and every MAL-named version counts as malicious (not checked).
  const args = process.argv.slice(2);
  const [dir, outFile] = args.filter(a => !a.startsWith("--"));
  if (!dir || !outFile) throw new Error("usage: replay.ts <data dir> <out.json> [--as-of=<ISO time>] [--cache=<dir>]");
  const flag = (k: string) => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const asOf = flag("as-of") ? Date.parse(flag("as-of")!) : Date.now();
  if (!Number.isFinite(asOf)) throw new Error("--as-of is not a time");
  if (existsSync(outFile)) throw new Error(`${outFile} exists; a replay never overwrites an earlier output.`);
  const watchedText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "watched.json"), "utf8");
  const malNames = new Set<string>();
  for (const r of lines(join(dir, "osv"))) for (const a of r.record?.affected ?? []) if (typeof a?.package?.name === "string") malNames.add(a.package.name);
  const store = readStore(dir, name => malNames.has(name));
  const cache = flag("cache");
  const sources = cache ? networkSources(cache) : null;
  const report = await replay({ store, watched: JSON.parse(watchedText).names, asOf, sources });
  const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const blobs = Object.fromEntries(["tools/shadow/src/replay.ts", "tools/shadow/src/disputed.ts", "tools/backtest/src/archives-v5.ts", "packages/cli/src/security/judge.ts", "packages/cli/src/security/npm-facts.ts", "packages/cli/src/security/time-cap.ts"].map(f => {
    const b = readFileSync(join(repo, f));
    return [f, createHash("sha1").update(`blob ${b.length}`).update(Buffer.from([0])).update(b).digest("hex")];
  }));
  writeFileSync(outFile, JSON.stringify({ ...report, run: { blobs, watched_sha256: createHash("sha256").update(watchedText).digest("hex"), node: process.version } }, null, 1) + "\n");
  console.log(renderReport(report));
}
