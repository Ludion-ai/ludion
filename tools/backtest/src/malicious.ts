// Backtest of the judge's gate 2 and wait against the known malicious npm releases of 2025 (docs/design.md,
// "ロードマップと検証ゲート" 1). For every OSV MAL- record of 2025 that names specific versions of a package that had
// earlier, clean versions (a compromised package, not a typosquat), it asks: had a project's update to that version
// been judged when the wait ended, would the judge have stopped it, from what was public at that moment?
//
// What was public when the wait ended, and how this reconstructs it:
// - The version's publish time: the registry keeps it even for removed versions (`time`).
// - The OSV MAL- record: public from its `published` time. The judge re-queries when the wait ends.
// - The previous version's provenance, publisher and install scripts: still in the registry.
// - The malicious version's own provenance, publisher and scripts: in the registry only if it was never removed.
//   Removed versions are counted as unknown; the "provenance inferred" column assumes a removed version that
//   replaced one with provenance had none (published with a stolen token), which is stated as an assumption.
// Removal and deprecation times are not in the registry, so they are never used: the result is a lower bound.
//
// Usage: node tools/backtest/src/malicious.ts <osv-npm-dir> <cache-dir> <out.json>
// Reads untrusted JSON only; runs nothing from it. Network: registry.npmjs.org, read-only, cached.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { installScripts, WAIT_HOURS } from "../../../packages/cli/src/security/judge.ts";

type Malicious = { id: string; name: string; versions: string[]; osvPublished: string };
type Packument = { time: Record<string, string>; versions: Record<string, { publisher: string | null; provenance: boolean; scripts: string[] }> };

const [osvDir, cacheDir, outFile] = process.argv.slice(2);
if (!osvDir || !cacheDir || !outFile) throw new Error("Usage: node tools/backtest/src/malicious.ts <osv-npm-dir> <cache-dir> <out.json>");
mkdirSync(cacheDir, { recursive: true });

/** 2025 MAL- records that name specific versions (a record over all versions is a package made to be malicious). */
function records(): Malicious[] {
  const out: Malicious[] = [];
  for (const file of readdirSync(osvDir!)) {
    if (!file.startsWith("MAL-")) continue;
    const record = JSON.parse(readFileSync(join(osvDir!, file), "utf8"));
    if (typeof record.published !== "string" || !record.published.startsWith("2025") || record.withdrawn) continue;
    for (const affected of record.affected ?? []) {
      if (affected?.package?.ecosystem !== "npm" || (affected.ranges ?? []).length) continue;
      const versions = (affected.versions ?? []).filter((v: unknown): v is string => typeof v === "string" && !!semver.valid(v));
      if (versions.length) out.push({ id: record.id, name: affected.package.name, versions, osvPublished: record.published });
    }
  }
  return out;
}

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
async function packument(name: string): Promise<Packument | null> {
  if (!NAME.test(name)) return null;
  const file = join(cacheDir!, `${encodeURIComponent(name)}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://registry.npmjs.org/${path}`, { headers: { accept: "application/json", "user-agent": "Ludion-Backtest" }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (res?.status === 404) { writeFileSync(file, "null"); return null; }
    if (!res?.ok) { if (attempt < 3) { await new Promise(r => setTimeout(r, 2_000 * (attempt + 1))); continue; } throw new Error(`registry ${name}: ${res?.status ?? "no response"}`); }
    const doc = await res.json() as any;
    const compact: Packument = { time: {}, versions: {} };
    for (const [k, v] of Object.entries(doc.time ?? {})) if (typeof v === "string" && semver.valid(k)) compact.time[k] = v;
    for (const [k, v] of Object.entries<any>(doc.versions ?? {})) compact.versions[k] = { publisher: v?._npmUser?.name ?? null, provenance: !!v?.dist?.attestations, scripts: installScripts(v?.scripts) };
    writeFileSync(file, JSON.stringify(compact));
    return compact;
  }
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; out[i] = await work(items[i]!); } }));
  return out;
}

const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;
const all = records();
const names = [...new Set(all.map(r => r.name))];
console.log(`${all.length} MAL- records with explicit versions in 2025, ${names.length} packages`);
let done = 0;
const docs = new Map(await pool(names, 8, async name => {
  const doc = await packument(name).catch(error => { console.error(String(error)); return undefined; });
  if (++done % 250 === 0) console.log(`registry ${done}/${names.length}`);
  return [name, doc] as const;
}));

type Row = {
  id: string; name: string; version: string; published: string; osv_published: string; hours_to_mal: number;
  previous: string; previous_provenance: boolean; present_now: boolean;
  /** Stops visible without assuming anything about removed versions. */
  static_stops: string[];
  /** Extra stop when a removed version replaced one with provenance (assumption: published without provenance). */
  inferred_provenance_stop: boolean;
};
const rows: Row[] = [], skipped = { no_registry: 0, no_publish_time: 0, no_earlier_clean_version: 0, registry_error: 0 };
for (const record of all) {
  const doc = docs.get(record.name);
  if (doc === undefined) { skipped.registry_error += record.versions.length; continue; }
  if (doc === null) { skipped.no_registry += record.versions.length; continue; }
  const bad = new Set(all.filter(r => r.name === record.name).flatMap(r => r.versions));
  for (const version of record.versions) {
    const published = doc.time[version];
    if (!published) { skipped.no_publish_time++; continue; }
    // A compromise: the package had a clean version at least a week before this one (a project could have had it).
    const earlier = Object.entries(doc.time).filter(([v, t]) => !bad.has(v) && Date.parse(t) <= Date.parse(published) - 7 * 86_400_000).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
    if (!earlier.length) { skipped.no_earlier_clean_version++; continue; }
    const previous = earlier[0]![0];
    const prev = doc.versions[previous], now = doc.versions[version];
    const stops: string[] = [];
    if (now && prev) {
      if (prev.provenance && !now.provenance) stops.push("provenance lost");
      if (now.scripts.some(s => !prev.scripts.includes(s))) stops.push("new install script");
    }
    rows.push({
      id: record.id, name: record.name, version, published, osv_published: record.osvPublished, hours_to_mal: Math.round(hours(published, record.osvPublished) * 10) / 10,
      previous, previous_provenance: !!prev?.provenance, present_now: !!now, static_stops: stops,
      inferred_provenance_stop: !now && !!prev?.provenance,
    });
  }
}

const caught = (row: Row, wait: number, inferred: boolean) => row.hours_to_mal <= wait || row.static_stops.length > 0 || (inferred && row.inferred_provenance_stop);
/** Per urgency: how many of the given malicious versions the judge would have stopped when the wait ended. */
const summarise = (set: Row[]) => ({
  versions: set.length,
  packages: new Set(set.map(r => r.name)).size,
  ...Object.fromEntries(Object.entries(WAIT_HOURS).map(([urgency, wait]) => [urgency, {
    wait_hours: wait,
    stopped_measured: set.filter(r => caught(r, wait, false)).length,
    stopped_with_provenance_inference: set.filter(r => caught(r, wait, true)).length,
    by_requery_only: set.filter(r => r.hours_to_mal <= wait).length,
  }])),
});
// Releases published in 2025 are the question. Older versions that first got a MAL- record in 2025 (dormant code
// found later, or backfilled records) are reported apart: no wait of days can catch them.
const recent = rows.filter(r => r.published.startsWith("2025"));
const summary = { published_2025: summarise(recent), published_earlier: summarise(rows.filter(r => !r.published.startsWith("2025"))) };
const sortedHours = recent.map(r => r.hours_to_mal).sort((a, b) => a - b);
const quantile = (q: number) => sortedHours[Math.min(sortedHours.length - 1, Math.floor(q * sortedHours.length))] ?? null;
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/malicious.ts.",
  sources: { osv: "OSV npm export (MAL- records published in 2025)", registry: "registry.npmjs.org packuments (time, versions)" },
  malicious_versions: rows.length,
  packages: new Set(rows.map(r => r.name)).size,
  skipped,
  hours_from_publish_to_mal_record_2025: { p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9), negative: recent.filter(r => r.hours_to_mal < 0).length },
  summary,
  rows: rows.sort((a, b) => a.published.localeCompare(b.published)),
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ malicious_versions: result.malicious_versions, packages: result.packages, skipped, hours: result.hours_from_publish_to_mal_record_2025, summary }, null, 2));
