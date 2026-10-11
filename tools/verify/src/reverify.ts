// Nightly reverify (docs/decisions.md, "Nightly reverify"): which failing lessons count tonight. A failure that may
// be the world's fault (a source page down, the npm registry or Docker unavailable) counts only when the same lesson
// also failed the night before; a test that ran and failed counts at once.
import type { LessonResult } from "./verify.ts";

export interface Failing {
  id: string;
  file: string;
  reasons: string[];
}

export interface FailingFile {
  checked_at: string;
  failing: Failing[];
}

/** A reason that could be a passing outage rather than the lesson no longer holding. */
export function isTransient(reason: string): boolean {
  return /^evidence \d+ \(source\):/.test(reason) || /: Could not install |: Could not start Docker/.test(reason);
}

export function confirmedFailures(tonight: LessonResult[], lastNight: LessonResult[] | undefined): Failing[] {
  const failedBefore = new Set((lastNight ?? []).filter((r) => r.status === "failed" && r.id).map((r) => r.id!));
  return tonight
    .filter((r) => r.status === "failed" && r.id)
    .filter((r) => !r.reasons.every(isTransient) || failedBefore.has(r.id!))
    .map((r) => ({ id: r.id!, file: r.file, reasons: r.reasons }));
}

const fence = (s: string) => "```text\n" + s.replace(/```/g, "'''") + "\n```";

/** The retraction PR's text. Reasons come from lesson output, so they're fenced as text, never markdown. */
export function retractionPr(f: Failing, runUrl: string): { title: string; body: string } {
  return {
    title: `Retract ${f.id}: its evidence no longer holds`,
    body: [
      "## What changed",
      "",
      `Deletes \`${f.file}\`: the nightly reverify (${runUrl}) found that its evidence fails. Ludion stopped serving it at the next deploy; merging this retracts it, and its page becomes a tombstone.`,
      "",
      "What failed:",
      "",
      fence(f.reasons.join("\n").slice(0, 6000)),
      "",
      "If the lesson still holds and the check is wrong, close this PR and fix the check; if the fact changed, a new lesson can replace it.",
      "",
      "GitHub doesn't run checks on pull requests opened by Actions: close and reopen this PR to run them before merging.",
      "",
      "## How to undo",
      "",
      "Revert the merge commit; the file comes back as it was.",
    ].join("\n"),
  };
}
