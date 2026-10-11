// The personal ledger: lessons a teacher taught on this machine, public or not. ~/.ludion/ledger/<id>.json
// (LUDION_HOME overrides ~/.ludion). Sync reads it alongside the public index, so a lesson taught in one project
// reaches every project on the machine.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateClaim, type LessonV1 } from "@ludion/core";
import type { SyncLesson } from "./match.ts";

export interface LedgerEntry {
  /** The lesson as it would be published; author fields are filled when the teacher's GitHub account is known. */
  lesson: LessonV1;
  taught_at: string;
  /** What this machine checked. tests: passed | failed | not run (why). sources: found | not found. */
  checks: { tests: string; sources: string };
  /** Set by teach --public. */
  public?: { pr_url: string };
}

export function ludionHome(): string {
  return process.env.LUDION_HOME || join(homedir(), ".ludion");
}

const ledgerDir = () => join(ludionHome(), "ledger");

export function saveEntry(entry: LedgerEntry): string {
  mkdirSync(ledgerDir(), { recursive: true });
  const path = join(ledgerDir(), `${entry.lesson.id}.json`);
  writeFileSync(path, JSON.stringify(entry, null, 2) + "\n");
  return path;
}

export function readLedger(): LedgerEntry[] {
  if (!existsSync(ledgerDir())) return [];
  const entries: LedgerEntry[] = [];
  for (const file of readdirSync(ledgerDir())) {
    if (!file.endsWith(".json")) continue;
    try {
      entries.push(JSON.parse(readFileSync(join(ledgerDir(), file), "utf8")) as LedgerEntry);
    } catch {
      // A damaged entry is skipped, not fatal.
    }
  }
  return entries;
}

/** A ledger entry as sync shows it. A lesson that is already public shows up from the index instead. */
export function ledgerLesson(e: LedgerEntry): SyncLesson {
  const passed = e.checks.tests === "passed" || (e.checks.tests === "none" && e.checks.sources === "found");
  return {
    id: e.lesson.id,
    package: e.lesson.package,
    versions: e.lesson.versions,
    claim: generateClaim(e.lesson),
    signal: e.lesson.signal,
    teacher: "you",
    verified: passed ? `${e.checks.tests === "passed" ? "test" : "source"} on this machine` : `not verified: tests ${e.checks.tests}, sources ${e.checks.sources}`,
    verified_at: e.taught_at,
    url: e.public?.pr_url,
    drafted_by: e.lesson.drafted_by,
    origin: "ledger",
  };
}
