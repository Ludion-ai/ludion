// Backtest, part 2: what the judge's rules cost on genuine fixes (docs/design.md, "ロードマップと検証ゲート" 1).
// A fixed sample of npm security fixes published in 2025 (OSV GHSA records published in 2025 whose fixed version was
// published in 2025, ordered by a hash so the sample does not depend on file order). For each, the update from the
// highest earlier version of the same major to the fixed version is judged with today's registry and OSV facts, and
// the result is either a delay (the wait the judge imposes, counted from the fix's publish time) or a stop.
//
// Today's facts stand in for the facts of the time, which over-counts in two places, both stated in the output:
// deprecations made after the wait would have ended count as stops, and urgency uses today's KEV list and EPSS score.
// Only the fixed package is in the diff; in a real lockfile, other changed packages can extend the wait.
//
// Usage: node tools/backtest/src/fixes.ts <osv-npm-dir> <out.json> [sample-size]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { judge, type Change } from "../../../packages/cli/src/security/judge.ts";
import { gatherFacts } from "../../../packages/cli/src/security/npm-facts.ts";

const [osvDir, outFile, size = "200"] = process.argv.slice(2);
if (!osvDir || !outFile) throw new Error("Usage: node tools/backtest/src/fixes.ts <osv-npm-dir> <out.json> [sample-size]");
const SAMPLE = Number(size);

type Candidate = { id: string; name: string; fixed: string; key: string };
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
      candidates.push({ id: record.id, name: affected.package.name, fixed: event.fixed, key });
    }
  }
}
candidates.sort((a, b) => a.key.localeCompare(b.key));
console.log(`${candidates.length} fixed versions in GHSA records published in 2025`);

const timeOf = new Map<string, Record<string, string>>();
async function times(name: string): Promise<Record<string, string> | null> {
  if (timeOf.has(name)) return timeOf.get(name)!;
  const path = name.startsWith("@") ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const res = await fetch(`https://registry.npmjs.org/${path}`, { headers: { accept: "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8" }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (!res?.ok) return null;
  // The abbreviated document has no times; fall back to the full one.
  let doc = await res.json() as any;
  if (!doc.time) {
    const full = await fetch(`https://registry.npmjs.org/${path}`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!full?.ok) return null;
    doc = await full.json();
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.time ?? {})) if (typeof v === "string" && semver.valid(k)) out[k] = v;
  timeOf.set(name, out);
  return out;
}

type Row = { id: string; name: string; from: string; to: string; fix_published: string; verdict: string; urgency: string; wait_hours: number; delay_hours: number | null; stops: string[]; extends: string[] };
const rows: Row[] = [], skipped: Record<string, number> = { fix_not_published_2025: 0, no_earlier_version: 0, registry: 0, facts: 0, duplicate: 0 };
const seen = new Set<string>();
for (const c of candidates) {
  if (rows.length >= SAMPLE) break;
  if (seen.has(`${c.name}@${c.fixed}`)) { skipped.duplicate!++; continue; }
  seen.add(`${c.name}@${c.fixed}`);
  const t = await times(c.name);
  if (!t) { skipped.registry!++; continue; }
  const published = t[c.fixed];
  if (!published?.startsWith("2025")) { skipped.fix_not_published_2025!++; continue; }
  const from = Object.keys(t).filter(v => !semver.prerelease(v) && semver.lt(v, c.fixed) && semver.major(v) === semver.major(c.fixed) && Date.parse(t[v]!) < Date.parse(published)).sort(semver.rcompare)[0];
  if (!from) { skipped.no_earlier_version!++; continue; }
  const change: Change = { name: c.name, from, to: c.fixed, dev: false, resolved: `https://registry.npmjs.org/${c.name}/-/${c.name.split("/").at(-1)}-${c.fixed}.tgz`, integrity: "sha512-backtest" };
  let gathered;
  try { gathered = await gatherFacts([change]); } catch (error) { skipped.facts!++; console.error(`${c.name}@${c.fixed}: ${String(error)}`); continue; }
  const result = judge({ changes: [change], facts: gathered.facts, fixes: gathered.fixes, files: ["package-lock.json"], now: new Date("2100-01-01T00:00:00Z") });
  const stops = result.findings.filter(f => f.effect === "stop" && f.gate !== 4).map(f => f.message);
  rows.push({
    id: c.id, name: c.name, from, to: c.fixed, fix_published: published, verdict: stops.length ? "stop" : "ready_except_build",
    urgency: result.urgency, wait_hours: result.wait_hours, delay_hours: stops.length ? null : result.wait_hours,
    stops, extends: result.findings.filter(f => f.effect === "extend").map(f => f.message),
  });
  if (rows.length % 20 === 0) console.log(`${rows.length}/${SAMPLE}`);
}

const delays = rows.map(r => r.delay_hours).filter((d): d is number => d !== null).sort((a, b) => a - b);
const count = (f: (r: Row) => boolean) => rows.filter(f).length;
const result = {
  generated_at: new Date().toISOString(),
  method: "See the header of tools/backtest/src/fixes.ts.",
  sample: rows.length,
  skipped,
  delay_hours: { median: delays[Math.floor(delays.length / 2)] ?? null, p90: delays[Math.floor(delays.length * 0.9)] ?? null, n: delays.length },
  stopped: count(r => r.verdict === "stop"),
  extended: count(r => r.extends.length > 0),
  by_urgency: Object.fromEntries(["exploited", "high", "normal", "low"].map(u => [u, count(r => r.urgency === u)])),
  stop_reasons: [...rows.flatMap(r => r.stops.map(s => s.replace(/^\S+ /, "").replace(/[\d.]+/g, "#").slice(0, 60))).reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
  caveats: [
    "Deprecation, provenance and publisher are today's registry facts, not those of the time; a later deprecation counts as a stop.",
    "Urgency uses today's CISA KEV list and today's EPSS score.",
    "Only the fixed package is in the diff; real lockfile changes can carry other packages that extend the wait.",
    "Gate 3 (build and test) is not part of the delay; it adds the time of one baseline and one candidate run.",
  ],
  rows,
};
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
const { rows: _rows, ...shown } = result;
console.log(JSON.stringify(shown, null, 2));
