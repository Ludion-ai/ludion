// `ludion check`: the scheduled workflow's first job (action/check.sh; docs/bench/lb2b-next1/definitions.md). Before
// Docker, it says for each fix of the saved policy's ecosystem whether `patch` has anything to do in this run: a fix
// whose wait cannot have ended (t*, a lower bound of the judge's wait_until) waits, and a fix that is not new is due only
// in the 12-hour slots that double from the last time anything about it changed. It reads no earlier run's record. A
// fact it cannot read never quiets a fix: the wait falls to the table's shortest and the fix is due.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import semver from "semver";
import { detectEcosystems, textFile, type Ecosystem } from "./inventory.ts";
import { WAIT_HOURS, type Urgency } from "./judge.ts";
import { namesNodeImage, nodeDay } from "./node.ts";
import { boundedJson, epssScores, kevCves } from "./npm-facts.ts";
import type { DependencyScan, Finding } from "./osv.ts";
import { phpDay, type Scan } from "./php.ts";
import { CONFIG, readConfig, rootPath } from "./project.ts";
import { READONLY_READERS } from "./readonly/index.ts";
import { scanProject, type ProjectScan } from "./scan.ts";
import { npmReleases, packagistReleases, type Releases } from "./time-cap.ts";

/** The slot a fix that is not new is counted in (definitions, 5): longer than every gap measured between scheduled runs. */
export const SLOT_HOURS = 12;
const HOUR = 3_600_000;
/** At most this many advisory records are read; with more, urgency and the anchors are unknown. */
const RECORD_LIMIT = 200;

export type CheckKey = {
  /** "php", "node", or "<ecosystem>:<package>". */
  key: string;
  /** waits: t* is later than now; due: patch has work for it; quiet: not new, and this slot does not double. */
  state: "due" | "waits" | "quiet";
  /** t*, the lower bound of the wait's end; null when the fix has no wait Ludion can bound. */
  not_before: string | null;
  /** The last time anything about the fix changed, as far as the check can read; null when unknown or not read. */
  anchor: string | null;
  /** quiet: the start of the next slot in which it is due. */
  next_due: string | null;
  why: string;
};
export type CheckAnswer = { schema: 1; checked_at: string; ecosystem: string | null; outside: string[] } &
  ({ decided: true; urgency: Urgency | "unknown" | null; keys: CheckKey[] } | { decided: false; reason: string });

/** Due in slot m (0-based, SLOT_HOURS each, from the anchor): m = 0 or a power of two. */
const doubles = (m: number) => m <= 0 || Number.isInteger(Math.log2(m));
/** Whether a fix anchored at `anchor` is due at `now`, and when it next is (ms). An anchor in the future is due. */
export function slot(anchor: number, now: number): { due: boolean; next: number } {
  if (anchor > now) return { due: true, next: now };
  const m = Math.floor((now - anchor) / (SLOT_HOURS * HOUR));
  if (doubles(m)) return { due: true, next: now };
  return { due: false, next: anchor + 2 ** Math.ceil(Math.log2(m + 1)) * SLOT_HOURS * HOUR };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").slice(0, 500);
const time = (text: unknown): number | null => typeof text === "string" && Number.isFinite(Date.parse(text)) ? Date.parse(text) : null;
const iso = (ms: number) => new Date(ms).toISOString();

/** What the check reads of one OSV record: its last change, its severity and aliases. */
type OsvRecord = { modified: number | null; severity: string | null; aliases: string[] };
async function osvRecord(id: string, fetchFn: typeof fetch): Promise<OsvRecord> {
  const item = await boundedJson(fetchFn, `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, {}, 4 * 1024 * 1024);
  if (item?.id !== id) throw new Error(`OSV answered another record for ${id}.`);
  return {
    modified: time(item.modified),
    severity: typeof item.database_specific?.severity === "string" ? item.database_specific.severity : null,
    aliases: Array.isArray(item.aliases) ? item.aliases.filter((a: unknown): a is string => typeof a === "string") : [],
  };
}

/** The judge's urgency rules (judge.ts urgencyOf, npm-facts.ts gatherFacts) over every finding; "unknown" when a fact is missing. */
async function urgencyOf(findings: Finding[], records: Map<string, OsvRecord | null>, fetchFn: typeof fetch): Promise<Urgency | "unknown"> {
  const aliases = (f: Finding) => [...new Set([f.advisory.id, ...f.advisory.aliases, ...(records.get(f.advisory.id)?.aliases ?? [])])];
  let kev: Set<string> | null = null;
  try { kev = await kevCves(fetchFn); } catch { kev = null; }
  if (kev && findings.some(f => aliases(f).some(a => kev!.has(a)))) return "exploited";
  if (!kev || findings.some(f => !records.get(f.advisory.id))) return "unknown";
  if (findings.some(f => records.get(f.advisory.id)!.severity?.toUpperCase() === "CRITICAL")) return "high";
  const cves = [...new Set(findings.flatMap(aliases).filter(a => a.startsWith("CVE-")))];
  if (!cves.length) return "normal";
  try {
    const { scores } = await epssScores(cves, fetchFn);
    return cves.some(c => (scores.get(c) ?? 0) >= 0.1) ? "high" : "normal";
  } catch { return "unknown"; }
}

/** One key's state from t* and the times the anchor is taken from (null: unknown, so the fix is due). */
function decide(key: string, notBefore: number | null, times: (number | null)[], now: number, why: string): CheckKey {
  if (notBefore !== null && notBefore > now) return { key, state: "waits", not_before: iso(notBefore), anchor: null, next_due: null, why: `the wait cannot end before ${iso(notBefore)}${why ? ` (${why})` : ""}` };
  const at = notBefore === null ? null : iso(notBefore);
  if (times.some(t => t === null)) return { key, state: "due", not_before: at, anchor: null, next_due: null, why: "a fact the anchor needs could not be read, so it is due" };
  const anchor = Math.max(notBefore ?? -Infinity, ...(times as number[])), s = slot(anchor, now);
  const m = Math.floor((now - anchor) / (SLOT_HOURS * HOUR));
  return s.due
    ? { key, state: "due", not_before: at, anchor: iso(anchor), next_due: null, why: anchor > now ? `its anchor ${iso(anchor)} is in the future` : `slot ${m} of ${SLOT_HOURS} hours since ${iso(anchor)}` }
    : { key, state: "quiet", not_before: at, anchor: iso(anchor), next_due: iso(s.next), why: `slot ${m} of ${SLOT_HOURS} hours since ${iso(anchor)}; next due ${iso(s.next)}` };
}

/** The other inventories in the folder, which this workflow's policy does not cover. */
function outsideOf(root: string, ecosystem: string | null, dockerfile: string): string[] {
  const out: string[] = detectEcosystems(root).filter(e => e !== ecosystem);
  try {
    if (existsSync(join(root, dockerfile))) {
      const text = textFile(root, dockerfile);
      if (ecosystem !== "php" && /\bphp:/.test(text)) out.push(`php (${dockerfile})`);
      if (ecosystem !== "node" && namesNodeImage(text)) out.push(`node (${dockerfile})`);
    }
  } catch { out.push(`${dockerfile} (not read)`); }
  for (const reader of READONLY_READERS) {
    const present = reader.files.filter(f => existsSync(join(root, f)));
    if (present.length) out.push(`${reader.ecosystem} (${present.join(", ")})`);
  }
  return out;
}

type Deps = { now?: Date; changedAt?: string | null; keysOnly?: boolean; fetchFn?: typeof fetch; scan?: (root: string, ecosystem: string) => Promise<ProjectScan> };

export async function checkProject(dir: string, deps: Deps = {}): Promise<CheckAnswer> {
  const now = (deps.now ?? new Date()).getTime(), fetchFn = deps.fetchFn ?? fetch, scan = deps.scan ?? scanProject;
  const root = rootPath(dir);
  const head = { schema: 1 as const, checked_at: iso(now) };
  let ecosystem: "php" | "node" | Ecosystem, dockerfile = "Dockerfile";
  try {
    const config = readConfig(root);
    if ("dockerfile" in config) { ecosystem = config.ecosystem ?? "php"; dockerfile = config.dockerfile; } else ecosystem = config.ecosystem;
  } catch (error) {
    return { ...head, ecosystem: null, outside: [], decided: false, reason: `${CONFIG} could not be read: ${message(error)}` };
  }
  const outside = outsideOf(root, ecosystem, dockerfile);
  const undecided = (reason: string): CheckAnswer => ({ ...head, ecosystem, outside, decided: false, reason });
  if (ecosystem === "maven") return undecided("a Maven scan resolves the dependency graph in Docker, which the check does not run; patch runs every time.");
  let report: ProjectScan;
  try { report = await scan(root, ecosystem); } catch (error) { return undecided(`ludion scan failed: ${message(error)}`); }
  const check = report.checks.length === 1 && report.checks[0]!.ecosystem === ecosystem ? report.checks[0]! : undefined;
  if (!check) return undecided(`the scan of ${ecosystem} answered ${report.checks.length} checks (${report.checks.map(c => c.ecosystem).join(", ")}).`);
  if ("error" in check) return undecided(`the ${ecosystem} check failed: ${message(check.error)}`);
  const changedAt = time(deps.changedAt ?? null);

  if (ecosystem === "php" || ecosystem === "node") {
    const result = check.result as Scan;
    if (!("current" in result)) return undecided("the image check answered a result of another shape.");
    if (!result.candidate) return { ...head, ecosystem, outside, decided: true, urgency: null, keys: [] };
    if (deps.keysOnly) return { ...head, ecosystem, outside, decided: true, urgency: null, keys: [{ key: ecosystem, state: "due", not_before: null, anchor: null, next_due: null, why: "keys only" }] };
    const day = ecosystem === "php" ? phpDay : nodeDay;
    const dayEnd = (date: string) => { const d = day(date); return d ? d.getTime() + 24 * HOUR : null; };
    const until = time(result.wait_until);
    if (result.wait_until !== undefined && until === null) return undecided("the image check's wait_until is not a time.");
    // The end of each newer security release's day, and of the candidate's day when the scan gives its wait (wait_until − 72h).
    const times = [changedAt, ...result.security_releases.map(r => dayEnd(r.date)), ...(until === null ? [] : [until - 72 * HOUR])];
    return { ...head, ecosystem, outside, decided: true, urgency: null, keys: [decide(ecosystem, until, times, now, result.status === "wait" ? "a move with no newer security release" : "")] };
  }

  const result = check.result as DependencyScan;
  if (!Array.isArray((result as { findings?: unknown }).findings) || !Array.isArray(result.plan)) return undecided("the dependency check answered a result of another shape.");
  if (result.status === "incomplete") return undecided(`the ${ecosystem} scan is incomplete: ${result.inventory.limitations.join(" ").slice(0, 300)}`);
  const clean = (name: string) => name.replace(/[^A-Za-z0-9@._/:~-]/g, "?");
  const packages = [...new Set(result.findings.map(f => f.package.name))].sort();
  if (deps.keysOnly) return { ...head, ecosystem, outside, decided: true, urgency: null, keys: packages.map(p => ({ key: `${ecosystem}:${clean(p)}`, state: "due" as const, not_before: null, anchor: null, next_due: null, why: "keys only" })) };

  // OSV records, by the ids OSV returned (a Packagist advisory id is never sent to OSV; it stays unknown).
  const ids = [...new Set(result.findings.map(f => f.advisory.id))];
  const records = new Map<string, OsvRecord | null>();
  for (const id of ids) {
    if (ids.length > RECORD_LIMIT || id.startsWith("PKSA-")) { records.set(id, null); continue; }
    try { records.set(id, await osvRecord(id, fetchFn)); } catch { records.set(id, null); }
  }
  const urgency = ecosystem === "npm" && result.findings.length ? await urgencyOf(result.findings, records, fetchFn) : null;
  const wait = urgency === null ? 0 : urgency === "unknown" ? WAIT_HOURS.exploited : WAIT_HOURS[urgency];

  const keys: CheckKey[] = [];
  for (const name of packages) {
    const own = result.findings.filter(f => f.package.name === name);
    let releases: Releases | null = null;
    try { releases = ecosystem === "npm" ? await npmReleases(name, fetchFn) : await packagistReleases(name, fetchFn); } catch { releases = null; }
    let notBefore: number | null = null, why = "";
    if (ecosystem === "npm") {
      // P: the earliest publish time of the versions the fix may take, every version not lower than the smallest planned.
      const tos = result.plan.filter(c => c.name === name).map(c => semver.valid(c.to)).filter((v): v is string => !!v).sort(semver.compare);
      const may = releases && tos.length ? [...releases.published].filter(([v]) => semver.valid(v) && semver.gte(v, tos[0]!)).map(([, at]) => time(at)) : [];
      if (may.length && may.every(t => t !== null)) {
        notBefore = Math.min(...(may as number[])) + wait * HOUR;
        why = `urgency ${urgency}, ${wait}h after ${iso(Math.min(...(may as number[])))}`;
      }
    }
    const newest = releases ? (ecosystem === "npm" ? time(releases.modified) : Math.max(...[...releases.published.values()].map(t => time(t) ?? NaN))) : null;
    const times = [changedAt, ...own.map(f => records.get(f.advisory.id)?.modified ?? null), newest !== null && Number.isFinite(newest) ? newest : null];
    keys.push(decide(`${ecosystem}:${clean(name)}`, notBefore, times, now, why));
  }
  return { ...head, ecosystem, outside, decided: true, urgency, keys };
}

/** The lines action/check.sh reads: tab-separated, one per key, nothing a shell would run. */
export function checkLines(answer: CheckAnswer): string[] {
  const field = (text: string) => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
  if (!answer.decided) return [`undecided\t${field(answer.reason)}`];
  return [
    `decided\t${field(answer.ecosystem ?? "-")}\t${answer.urgency ?? "-"}`,
    ...answer.outside.map(o => `outside\t${field(o)}`),
    ...answer.keys.map(k => `key\t${k.state}\t${field(k.key).replace(/\s/g, "?")}\t${k.state === "waits" ? k.not_before : k.state === "quiet" ? k.next_due : "-"}\t${field(k.why)}`),
  ];
}

/** `ludion check [--dir <path>] [--changed-at <time>] [--keys-only] [--json]`. Exit 0 with an answer, 2 when undecided. */
export async function checkCli(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { dir: { type: "string", default: "." }, "changed-at": { type: "string" }, "keys-only": { type: "boolean" }, json: { type: "boolean" } } });
  const answer = await checkProject(values.dir!, { changedAt: values["changed-at"] ?? null, keysOnly: !!values["keys-only"] });
  console.log(values.json ? JSON.stringify(answer, null, 2) : checkLines(answer).join("\n"));
  return answer.decided ? 0 : 2;
}
