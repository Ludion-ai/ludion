import semver from "semver";
import type { Evidence, Lesson, LessonV1, TestEvidence } from "./types.ts";
import { isV1 } from "./types.ts";

type Test = TestEvidence["test"];

/** The version of the lesson's own package that a test pins: from `packages`, or from the runtime for node and python. */
export function pinnedVersion(test: Test, pkg: LessonV1["package"]): string | undefined {
  const raw = pkg.ecosystem === "runtime" ? (test.runtime.startsWith(`${pkg.name}@`) ? test.runtime.slice(pkg.name.length + 1) : undefined) : test.packages?.[pkg.name];
  return raw == null ? undefined : (semver.valid(raw) ?? semver.coerce(raw)?.version ?? undefined);
}

/**
 * A differential pair: the same code passes on a pinned version of the lesson's package inside `versions` and fails
 * as expected on a pinned version outside it. Only then does the label say "across versions".
 */
export function isDifferential(lesson: LessonV1): boolean {
  const tests = lesson.evidence.flatMap((e) => ("test" in e ? [e.test] : []));
  const inRange = (t: Test) => {
    const v = pinnedVersion(t, lesson.package);
    return v == null ? undefined : semver.satisfies(v, lesson.versions, { includePrerelease: true });
  };
  const pass = tests.filter((t) => (t.expect ?? "pass") === "pass" && inRange(t) === true);
  const fail = tests.filter((t) => t.expect === "fail" && inRange(t) === false);
  return pass.some((p) => fail.some((f) => f.code === p.code));
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
