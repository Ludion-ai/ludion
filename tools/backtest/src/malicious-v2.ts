// Backtest rerun, malicious releases (docs/decisions.md, "Backtest rerun: definitions fixed before running it").
// Same data as malicious.ts, with the registered definitions:
// - Denominator: versions named by a 2025 OSV MAL- record whose package had a legitimate version at least 7 days
//   earlier, and that Ludion's smallest-fix logic could select: directly (an OSV vulnerability record's fixed event is
//   exactly this version) or as a transitive dependency moving in the diff (the highest non-prerelease version
//   satisfying ^prev among the versions published by then). Packages without such an earlier version are new fake
//   packages, counted only.
// - Stop: at publish + wait, any of the re-query (MAL- record public), provenance regression or install scripts added.
//   Publisher change, new dependencies and an unlisted predecessor extend the wait as the judge does. Deprecation has no
//   time in the registry and is shown as an upper bound only. Removed versions' own facts are unknown: they fire nothing.
//
// Usage: node tools/backtest/src/malicious-v2.ts <osv-npm-dir> <cache-dir> <out.json>
// Reads untrusted JSON only; runs nothing from it. Network: registry.npmjs.org, read-only, cached.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { EXPLOITED_UNCOMPARABLE_HOURS, EXTENDED_MIN_HOURS, installScripts, WAIT_HOURS, type Urgency } from "../../../packages/cli/src/security/judge.ts";
import { provenanceFrom } from "../../../packages/cli/src/security/npm-facts.ts";

type Malicious = { id: string; name: string; versions: string[]; osvPublished: string; osvModified: string };
type Version = { publisher: string | null; provenance: boolean; scripts: string[]; deps: string[]; deprecated: boolean };
type Packument = { time: Record<string, string>; versions: Record<string, Version> };

const [osvDir, cacheDir, outFile] = process.argv.slice(2);
if (!osvDir || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/malicious-v2.ts <osv-npm-dir> <cache-dir> <out.json>");
mkdirSync(cacheDir, { recursive: true });

const all: Malicious[] = [];
/** Fixed events of OSV vulnerability records (not MAL-), per npm package: the versions the planner can select. */
const fixedEvents = new Map<string, Set<string>>();
for (const file of readdirSync(osvDir)) {
  if (!file.endsWith(".json")) continue;
  const record = JSON.parse(readFileSync(join(osvDir, file), "utf8"));
  if (record.withdrawn) continue;
  for (const affected of record.affected ?? []) {
    if (affected?.package?.ecosystem !== "npm" || typeof affected.package.name !== "string") continue;
    const name: string = affected.package.name;
    if (file.startsWith("MAL-")) {
      if (typeof record.published !== "string" || !record.published.startsWith("2025") || (affected.ranges ?? []).length) continue;
      const versions = (affected.versions ?? []).filter((v: unknown): v is string => typeof v === "string" && !!semver.valid(v));
      if (versions.length) all.push({ id: record.id, name, versions, osvPublished: record.published, osvModified: typeof record.modified === "string" ? record.modified : record.published });
    } else {
      for (const range of affected.ranges ?? []) for (const event of range.events ?? []) {
        if (typeof event.fixed === "string" && semver.valid(event.fixed)) fixedEvents.set(name, (fixedEvents.get(name) ?? new Set()).add(semver.valid(event.fixed)!));
      }
    }
  }
}

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const registryPath = (name: string) => name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "Ludion-Backtest" }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (res?.status === 404) return null;
    if (res?.ok) return res.json();
    if (attempt < 3) { await new Promise(r => setTimeout(r, 2_000 * (attempt + 1))); continue; }
    throw new Error(`${url}: ${res?.status ?? "no response"}`);
  }
}
async function packument(name: string): Promise<Packument | null> {
  if (!NAME.test(name)) return null;
  const file = join(cacheDir!, `${encodeURIComponent(name)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const doc = await getJson(`https://registry.npmjs.org/${registryPath(name)}`);
  const compact: Packument | null = doc && { time: {}, versions: {} };
  if (doc) {
    for (const [k, v] of Object.entries(doc.time ?? {})) if (typeof v === "string" && semver.valid(k)) compact!.time[k] = v;
    for (const [k, v] of Object.entries<any>(doc.versions ?? {})) compact!.versions[k] = {
      publisher: v?._npmUser?.name ?? null, provenance: !!v?.dist?.attestations, scripts: installScripts(v?.scripts),
      deps: Object.keys({ ...v?.dependencies, ...v?.optionalDependencies }).sort(), deprecated: typeof v?.deprecated === "string" && !!v.deprecated,
    };
  }
  writeFileSync(file, JSON.stringify(compact));
  return compact;
}
async function attestation(name: string, version: string): Promise<{ repository: string | null; workflow: string | null } | null> {
  const file = join(cacheDir!, `${encodeURIComponent(`${name}@${version}`)}.att.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const doc = await getJson(`https://registry.npmjs.org/-/npm/v1/attestations/${registryPath(name)}@${encodeURIComponent(version)}`);
  const out = doc ? provenanceFrom(doc) : null;
  writeFileSync(file, JSON.stringify(out));
  return out;
}
async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]!); } }));
  return out;
}

const names = [...new Set(all.map(r => r.name))];
console.log(`${all.length} MAL- records with explicit versions in 2025, ${names.length} packages; ${fixedEvents.size} npm packages with fixed events`);
let done = 0;
const docs = new Map(await pool(names, 8, async name => {
  const doc = await packument(name).catch(error => { console.error(String(error)); return undefined; });
  if (++done % 500 === 0) console.log(`registry ${done}/${names.length}`);
  return [name, doc] as const;
}));

const hours = (from: string, to: number) => (to - Date.parse(from)) / 3_600_000;
const SIGNALS = ["requery", "provenance", "install_scripts"] as const;
type Row = {
  id: string; name: string; version: string; published: string; previous: string; selectable: ("direct" | "transitive")[];
  present: boolean; previous_present: boolean; hours_to_mal: number; hours_to_mal_conservative: number;
  /** Signals that do not depend on the wait. */
  provenance_regression: boolean; install_scripts_added: boolean;
  extends: string[]; comparable: boolean; deprecated_now: boolean; inferred_provenance_stop: boolean;
};
const rows: Row[] = [];
const unknown = { no_registry: 0, no_publish_time: 0, registry_error: 0 };
const fake = { versions: 0, packages: new Set<string>() }, notSelectable = { versions: 0, packages: new Set<string>() };
const seen = new Set<string>();
for (const record of all) {
  const doc = docs.get(record.name);
  const bad = new Set(all.filter(r => r.name === record.name).flatMap(r => r.versions));
  const records = all.filter(r => r.name === record.name);
  for (const version of record.versions) {
    // A version named by several records is one malicious version; its record time is the earliest that names it.
    if (seen.has(`${record.name}@${version}`)) continue;
    seen.add(`${record.name}@${version}`);
    if (doc === undefined) { unknown.registry_error++; continue; }
    if (doc === null) { unknown.no_registry++; continue; }
    const published = doc.time[version];
    if (!published) { unknown.no_publish_time++; continue; }
    const at = Date.parse(published);
    const earlier = Object.entries(doc.time).filter(([v, t]) => !bad.has(v) && Date.parse(t) <= at - 7 * 86_400_000).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
    if (!earlier.length) { fake.versions++; fake.packages.add(record.name); continue; }
    const previous = earlier[0]![0];
    const selectable: Row["selectable"] = [];
    if (!semver.prerelease(version) && fixedEvents.get(record.name)?.has(semver.valid(version)!)) selectable.push("direct");
    const range = `^${previous}`;
    const newest = Object.entries(doc.time).filter(([v, t]) => Date.parse(t) <= at && !semver.prerelease(v) && semver.satisfies(v, range)).map(([v]) => v).sort(semver.rcompare)[0];
    if (newest === version) selectable.push("transitive");
    if (!selectable.length) { notSelectable.versions++; notSelectable.packages.add(record.name); continue; }

    // The record times for this version: optimistic `published`; conservative `modified` when it may have been added later.
    const naming = records.filter(r => r.versions.includes(version));
    const times = naming.map(r => {
      const earliest = Math.min(...r.versions.map(v => Date.parse(doc.time[v] ?? published)));
      const uncertain = at > Date.parse(r.osvPublished) || (r.versions.length > 1 && at > earliest + 3_600_000);
      return { optimistic: Date.parse(r.osvPublished), conservative: uncertain ? Math.max(Date.parse(r.osvPublished), Date.parse(r.osvModified)) : Date.parse(r.osvPublished) };
    });
    const prev = doc.versions[previous], now = doc.versions[version];
    let provenanceRegression = false, scriptsAdded = false, comparable = false;
    const extend: string[] = [];
    if (!prev) {
      extend.push("previous version no longer listed");
      if (now?.scripts.length) scriptsAdded = true;
    } else if (now) {
      if (prev.provenance && !now.provenance) provenanceRegression = true;
      if (prev.provenance && now.provenance) {
        const [a, b] = await Promise.all([attestation(record.name, previous), attestation(record.name, version)]);
        if (a?.repository !== b?.repository || a?.workflow !== b?.workflow) provenanceRegression = true;
        comparable = !!(a?.repository && a.workflow && b?.repository && b.workflow);
      }
      if (now.scripts.some(s => !prev.scripts.includes(s))) scriptsAdded = true;
      if (prev.publisher !== now.publisher) extend.push("publisher changed");
      if (now.deps.some(d => !prev.deps.includes(d))) extend.push("new dependencies");
    }
    rows.push({
      id: naming.map(r => r.id).join(","), name: record.name, version, published, previous, selectable,
      present: !!now, previous_present: !!prev,
      hours_to_mal: Math.round(hours(published, Math.min(...times.map(t => t.optimistic))) * 10) / 10,
      hours_to_mal_conservative: Math.round(hours(published, Math.min(...times.map(t => t.conservative))) * 10) / 10,
      provenance_regression: provenanceRegression, install_scripts_added: scriptsAdded, extends: extend, comparable,
      deprecated_now: !!now?.deprecated, inferred_provenance_stop: !now && !!prev?.provenance,
    });
  }
}

/** The judge's wait for this version at urgency u. */
function wait(row: Row, u: Urgency): number {
  let w = WAIT_HOURS[u];
  if (u === "exploited" && !row.comparable) w = EXPLOITED_UNCOMPARABLE_HOURS;
  if (row.extends.length) w = Math.max(w * 2, EXTENDED_MIN_HOURS);
  return w;
}
function signals(row: Row, u: Urgency, timing: "conservative" | "optimistic") {
  const mal = timing === "conservative" ? row.hours_to_mal_conservative : row.hours_to_mal;
  return { requery: mal <= wait(row, u), provenance: row.provenance_regression, install_scripts: row.install_scripts_added };
}
const stopped = (row: Row, u: Urgency, timing: "conservative" | "optimistic" = "conservative", inferred = false) => Object.values(signals(row, u, timing)).some(Boolean) || (inferred && row.inferred_provenance_stop);
const quantile = (values: number[], q: number) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))]! : null; };
function summarise(set: Row[]) {
  return {
    versions: set.length, packages: new Set(set.map(r => r.name)).size,
    direct: set.filter(r => r.selectable.includes("direct")).length, transitive: set.filter(r => r.selectable.includes("transitive")).length,
    removed_from_registry: set.filter(r => !r.present).length, deprecated_now_upper_bound: set.filter(r => r.deprecated_now).length,
    hours_to_mal_conservative: { p10: quantile(set.map(r => r.hours_to_mal_conservative), 0.1), median: quantile(set.map(r => r.hours_to_mal_conservative), 0.5), p90: quantile(set.map(r => r.hours_to_mal_conservative), 0.9) },
    by_urgency: Object.fromEntries((Object.keys(WAIT_HOURS) as Urgency[]).map(u => {
      const fires = Object.fromEntries(SIGNALS.map(s => [s, set.filter(r => signals(r, u, "conservative")[s]).length]));
      const alone = Object.fromEntries(SIGNALS.map(s => [s, set.filter(r => { const f = signals(r, u, "conservative"); return f[s] && SIGNALS.every(o => o === s || !f[o]); }).length]));
      return [u, {
        base_wait_hours: WAIT_HOURS[u],
        stopped: set.filter(r => stopped(r, u)).length,
        stopped_optimistic: set.filter(r => stopped(r, u, "optimistic")).length,
        stopped_with_provenance_inference: set.filter(r => stopped(r, u, "conservative", true)).length,
        not_stopped: set.filter(r => !stopped(r, u)).length,
        signal_fires: fires, signal_alone: alone,
        requery_only_within_extended_wait: set.filter(r => r.extends.length && signals(r, u, "conservative").requery && r.hours_to_mal_conservative > (u === "exploited" && !r.comparable ? EXPLOITED_UNCOMPARABLE_HOURS : WAIT_HOURS[u])).length,
      }];
    })),
  };
}
const summary = summarise(rows);
const gate = (Object.keys(WAIT_HOURS) as Urgency[]).every(u => summary.by_urgency[u]!.stopped === rows.length) && rows.length > 0;
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/src/malicious-v2.ts and docs/decisions.md, \"Backtest rerun: definitions fixed before running it\".",
  sources: { osv: "OSV npm export (MAL- records published in 2025; vulnerability records for fixed events)", registry: "registry.npmjs.org packuments and attestations" },
  records: all.length, record_packages: names.length,
  unknown, new_fake_packages: { versions: fake.versions, packages: fake.packages.size },
  not_selectable: { versions: notSelectable.versions, packages: notSelectable.packages.size },
  denominator: summary,
  published_2025_only: summarise(rows.filter(r => r.published.startsWith("2025"))),
  gate_every_malicious_version_stopped: gate ? "met" : "not met",
  rows: rows.sort((a, b) => a.published.localeCompare(b.published)),
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify(shown, null, 2));
