// The personal ledger: lessons a teacher taught on this machine, public or not. ~/.ludion/ledger/<id>.json
// (LUDION_HOME overrides ~/.ludion). Sync reads it alongside the public index, so a lesson taught in one project
// reaches every project on the machine.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateClaim, hasNoEvidence, lessonProblems, unverifiedProblems, validateLessonV1, validateUnverified, type LessonV1 } from "@ludion/core";
import type { SyncLesson } from "./match.ts";

export interface LedgerEntry {
  /** The lesson as it would be published; author fields are filled when the teacher's GitHub account is known. */
  lesson: LessonV1;
  taught_at: string;
  /** What this machine checked. tests: passed | failed | not run (why). sources: found | not found. */
  checks: { tests: string; sources: string };
  /** Taught without evidence: shown only to its teacher, as "unverified, yours only"; --public refuses it. */
  unverified?: boolean;
  /** Set by teach --public. */
  public?: { pr_url: string };
}

/** How sync labels a ledger lesson taught without evidence. */
export const UNVERIFIED = "unverified, yours only";

export function ludionHome(): string {
  return process.env.LUDION_HOME || join(homedir(), ".ludion");
}

const ledgerDir = () => join(ludionHome(), "ledger");
const MAX_ENTRY_BYTES = 256 * 1024;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** A ledger file is data too: JSON syntax alone must not bypass the teaching schema or inject status text. */
export function parseLedgerEntry(data: unknown): LedgerEntry | undefined {
  if (!object(data) || !object(data.lesson) || !object(data.checks)) return undefined;
  const { tests, sources } = data.checks;
  if (typeof tests !== "string" || !["none", "passed", "failed", "not run", "not run (Docker isn't installed here; CI runs them)"].includes(tests)) return undefined;
  if (typeof sources !== "string" || !["none", "found", "not found", "not checked"].includes(sources)) return undefined;
  if (typeof data.taught_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(data.taught_at) || !Number.isFinite(Date.parse(data.taught_at))) return undefined;
  if (data.unverified !== undefined && typeof data.unverified !== "boolean") return undefined;
  const unverified = hasNoEvidence(data.lesson);
  if (data.unverified === true && !unverified) return undefined;
  const v = unverified ? validateUnverified({ ...data.lesson, evidence: [] }) : validateLessonV1(data.lesson);
  if (!v.ok) return undefined;
  const lesson = v.lesson as LessonV1;
  if ((unverified ? unverifiedProblems(lesson) : lessonProblems(lesson)).length) return undefined;
  let published: LedgerEntry["public"];
  if (data.public !== undefined) {
    if (!object(data.public) || typeof data.public.pr_url !== "string" || data.public.pr_url.length > 2048 || /[\u0000-\u0020\u007f]/.test(data.public.pr_url)) return undefined;
    try {
      const u = new URL(data.public.pr_url);
      if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.href !== data.public.pr_url || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*\/?$/.test(u.pathname)) return undefined;
    } catch { return undefined; }
    published = { pr_url: data.public.pr_url };
  }
  return { lesson, taught_at: data.taught_at, checks: { tests, sources }, ...(unverified ? { unverified: true } : {}), ...(published ? { public: published } : {}) };
}

export function saveEntry(entry: LedgerEntry): string {
  const valid = parseLedgerEntry(entry);
  if (!valid) throw new Error("The ledger entry is not valid. Nothing was saved.");
  const text = JSON.stringify(valid, null, 2) + "\n";
  if (Buffer.byteLength(text) > MAX_ENTRY_BYTES) throw new Error("The ledger entry is too large. Nothing was saved.");
  mkdirSync(ledgerDir(), { recursive: true, mode: 0o700 });
  const path = join(ledgerDir(), `${valid.lesson.id}.json`);
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
  return path;
}

export function readLedger(): LedgerEntry[] {
  if (!existsSync(ledgerDir())) return [];
  const entries: LedgerEntry[] = [];
  for (const file of readdirSync(ledgerDir())) {
    if (!file.endsWith(".json")) continue;
    try {
      const path = join(ledgerDir(), file);
      const st = lstatSync(path);
      if (!st.isFile() || st.size > MAX_ENTRY_BYTES) continue;
      const entry = parseLedgerEntry(JSON.parse(readFileSync(path, "utf8")));
      if (entry) entries.push(entry);
    } catch {
      // A damaged entry is skipped, not fatal.
    }
  }
  return entries;
}

/** A ledger entry as sync shows it. A lesson that is already public shows up from the index instead. */
export function ledgerLesson(e: LedgerEntry): SyncLesson {
  if (e.unverified || !e.lesson.evidence?.length) {
    return { id: e.lesson.id, package: e.lesson.package, versions: e.lesson.versions, claim: generateClaim(e.lesson), signal: e.lesson.signal, kind: e.lesson.kind, teacher: "you", verified: UNVERIFIED, verified_at: e.taught_at, drafted_by: e.lesson.drafted_by, origin: "ledger", replaces: e.lesson.replaces };
  }
  const passed = e.checks.tests === "passed" || (e.checks.tests === "none" && e.checks.sources === "found");
  return {
    id: e.lesson.id,
    package: e.lesson.package,
    versions: e.lesson.versions,
    claim: generateClaim(e.lesson),
    signal: e.lesson.signal,
    kind: e.lesson.kind,
    teacher: "you",
    verified: passed ? `${e.checks.tests === "passed" ? "test" : "source"} on this machine` : `not verified: tests ${e.checks.tests}, sources ${e.checks.sources}`,
    verified_at: e.taught_at,
    url: e.public?.pr_url,
    drafted_by: e.lesson.drafted_by,
    origin: "ledger",
    replaces: e.lesson.replaces,
  };
}
