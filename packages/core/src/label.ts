import semver from "semver";
import type { Evidence, Lesson, LessonV1, TestEvidence } from "./types.ts";
import { isV1 } from "./types.ts";

type Test = TestEvidence["test"];

const language = (runtime: string) => runtime.split("@")[0];

/**
 * Whether a test's pin of the lesson's own package is inside `versions`: true, false, or undefined when it can't say.
 * npm and pypi pins are exact versions, and count only on a runtime of the matching language (node for npm, python
 * for pypi). A runtime pin (node@22, python@3.12) names a whole release line, so it counts only when the entire line
 * is inside or outside the range: node@22 against >=22.3.0 says nothing.
 */
export function pinInRange(test: Test, lesson: Pick<LessonV1, "package" | "versions">): boolean | undefined {
  const { ecosystem, name } = lesson.package;
  const sat = (v: string) => semver.satisfies(v, lesson.versions, { includePrerelease: false });
  if (ecosystem === "runtime") {
    if (language(test.runtime) !== name) return undefined;
    const line = test.runtime.slice(name.length + 1);
    const parts = line.split(".");
    const low = semver.coerce(line)?.version;
    if (!low) return undefined;
    const high = parts.length === 1 ? `${parts[0]}.999999.999999` : `${parts[0]}.${parts[1]}.999999`;
    const lo = sat(low);
    return lo === sat(high) ? lo : undefined;
  }
  if ((ecosystem === "npm" && language(test.runtime) !== "node") || (ecosystem === "pypi" && language(test.runtime) !== "python")) return undefined;
  const pinned = test.packages?.[name];
  return pinned != null && semver.valid(pinned) ? sat(pinned) : undefined;
}

/** Everything a test pins apart from the lesson's own package: these must be the same on both sides of a pair. */
function otherPins(test: Test, lesson: LessonV1): string {
  const others = Object.entries(test.packages ?? {}).filter(([n]) => !(lesson.package.ecosystem !== "runtime" && n === lesson.package.name));
  others.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([lesson.package.ecosystem === "runtime" ? language(test.runtime) : test.runtime, others]);
}

/**
 * A differential pair: the same code, on the same runtime with the same other pins, passes on a version of the
 * lesson's own package inside `versions` and fails as expected on a version outside it. Only the lesson's package
 * differs, so the difference is the change the lesson names. Only then does the label say "across versions".
 */
export function isDifferential(lesson: LessonV1): boolean {
  const tests = lesson.evidence.flatMap((e) => ("test" in e ? [e.test] : []));
  const pass = tests.filter((t) => (t.expect ?? "pass") === "pass" && pinInRange(t, lesson) === true);
  const fail = tests.filter((t) => t.expect === "fail" && pinInRange(t, lesson) === false);
  return pass.some((p) => fail.some((f) => f.code === p.code && otherPins(f, lesson) === otherPins(p, lesson)));
}

/**
 * The label shown to readers, derived, never stored. It never says more than the evidence shows:
 * differential (format 1, see isDifferential); proof: any Lean run (format 0); test: any test or run; source: sources only.
 */
export function verifiedBy(lesson: Lesson): "test" | "proof" | "source" | "differential" {
  if (isV1(lesson)) {
    if (isDifferential(lesson)) return "differential";
    return lesson.evidence.some((e) => "test" in e) ? "test" : "source";
  }
  const runs = lesson.evidence.filter((e) => "run" in e);
  if (runs.some((e) => e.run.runner === "lean")) return "proof";
  if (runs.length > 0) return "test";
  return "source";
}

/** A format 0 run or a format 1 test in one shape, for display. Undefined for a source. */
export function asTest(e: Evidence): { runtime: string; code: string; packages?: Record<string, string>; expect?: "pass" | "fail"; error?: string } | undefined {
  if ("run" in e) return { runtime: e.run.runner, code: e.run.code };
  if ("test" in e) return e.test;
  return undefined;
}
