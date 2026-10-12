// Ludion holds some changes of some packages. Every list of lessons an assistant reads says so, so that a missing
// lesson is never read as "nothing changed" (docs/decisions.md, "Partial coverage").

export const COVERAGE_LINE =
  "Ludion holds some changes of some packages, not all of them. No lesson for something is no evidence that it didn't change: check primary sources too (changelogs, release notes, the installed package's code).";

/** Where to ask for lessons for a package Ludion doesn't cover: an issue form that labels it subject-request. */
export const SUBJECT_REQUEST_URL = "https://github.com/Ludion-ai/ludion/issues/new?template=subject-request.yml";

export function subjectRequestUrl(packages: string[]): string {
  return packages.length ? `${SUBJECT_REQUEST_URL}&title=${encodeURIComponent(`Lessons for ${packages.slice(0, 5).join(", ")}`)}` : SUBJECT_REQUEST_URL;
}
