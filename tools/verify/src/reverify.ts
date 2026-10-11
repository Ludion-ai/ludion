// Nightly reverify (docs/decisions.md, "Nightly reverify"): which failing lessons count tonight. A failure that may
// be the world's fault (a source page down, the npm registry or Docker unavailable, a slow runner) counts only when
// the same lesson also failed the night before; a test that ran and failed counts at once.
import type { LessonResult } from "./verify.ts";

export interface Failing {
  id: string;
  file: string;
  reasons: string[];
}

export interface FailingFile {
  checked_at: string;
  /** Lessons withheld from the index until they pass again or are retracted. On a suspended night, last night's list. */
  failing: Failing[];
  /** Set when so many lessons failed at once that the cause is likely the check: tonight changes nothing (last night's list stands). */
  suspended?: { failed: number; checked: number };
}

const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const FILE = /^lessons\/[a-z0-9][a-z0-9._-]{0,63}\/([0-9A-HJKMNP-TV-Z]{26})\.json$/;

/** A reason that could be a passing outage rather than the lesson no longer holding. */
export function isTransient(reason: string): boolean {
  return (
    /^evidence \d+ \(source\):/.test(reason) ||
    /: Could not install |: Could not start Docker|: The test ran too long|: The test exited with code 125\b/.test(reason)
  );
}

export function confirmedFailures(tonight: LessonResult[], lastNight: LessonResult[] | undefined): Failing[] {
  const failedBefore = new Set((lastNight ?? []).filter((r) => r.status === "failed" && r.id).map((r) => r.id!));
  return tonight
    .filter((r) => r.status === "failed" && r.id)
    .filter((r) => !r.reasons.every(isTransient) || failedBefore.has(r.id!))
    .map((r) => ({ id: r.id!, file: r.file, reasons: r.reasons }));
}

/** More failures at once than lessons plausibly break in a night: more than 3, and more than a fifth of all. */
export function tooMany(failed: number, checked: number): boolean {
  return failed > 3 && failed > checked / 5;
}

/**
 * What tonight decides: the failing list. When the failures look like the check's own fault, tonight changes nothing:
 * last night's list stands, so lessons already confirmed failing stay withheld and no new ones are.
 */
export function decide(tonight: LessonResult[], lastNight: LessonResult[] | undefined, now: Date, lastFailing: Failing[] = [], lastCheckedAt?: string): FailingFile {
  const failing = confirmedFailures(tonight, lastNight);
  const checked_at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  // The carried list keeps its own date: it is the night those failures were found, not the night the check broke.
  if (tooMany(failing.length, tonight.length)) return { checked_at: lastCheckedAt ?? checked_at, failing: lastFailing, suspended: { failed: failing.length, checked: tonight.length } };
  return { checked_at, failing };
}

/** A failing entry read back from an artifact: only a real lesson id at its own path, else undefined. */
export function safeFailing(f: Partial<Failing>): Failing | undefined {
  if (typeof f.id !== "string" || !ID.test(f.id) || typeof f.file !== "string") return undefined;
  const m = FILE.exec(f.file);
  if (!m || m[1] !== f.id) return undefined;
  return { id: f.id, file: f.file, reasons: Array.isArray(f.reasons) ? f.reasons.filter((r): r is string => typeof r === "string") : [] };
}

const fence = (s: string) => "```text\n" + s.replace(/```/g, "'''") + "\n```";

/**
 * The issue for a failing lesson. GitHub Actions can't open pull requests in this repository, so the retraction is
 * a prepared branch; a person opens the PR with one click (and CI runs on it, which it wouldn't for a PR opened by
 * Actions). Reasons come from lesson output, so they're fenced as text, never markdown.
 */
export function retractionIssue(f: Failing, repo: string, runUrl: string): { title: string; body: string } {
  return {
    title: `Retract ${f.id}: its evidence fails the nightly check`,
    body: [
      `The nightly reverify (${runUrl}) found that the evidence of \`${f.file}\` fails. Ludion stopped serving the lesson at the next deploy; it stays on main, withheld, until it passes its check again or is retracted.`,
      "",
      "What failed:",
      "",
      fence(f.reasons.join("\n").slice(0, 6000)),
      "",
      `**To retract it**, open the prepared pull request, which deletes the file: https://github.com/${repo}/compare/main...retract/${f.id}?expand=1. CI runs on it, and its page becomes a tombstone once merged.`,
      "",
      "If the lesson still holds and the check is wrong, fix the check and close this issue. Closing it stops these reports for this lesson; the lesson stays withheld while it keeps failing.",
    ].join("\n"),
  };
}
