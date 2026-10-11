import { describe, expect, it } from "vitest";
import { confirmedFailures, decide, isTransient, retractionIssue, safeFailing, tooMany } from "../src/reverify.ts";
import type { LessonResult } from "../src/verify.ts";

const result = (id: string, status: LessonResult["status"], reasons: string[] = []): LessonResult => ({ file: `lessons/x/${id}.json`, id, claim: "c", status, reasons, labels: [] });
const A = "01K70000000000000000000001";
const B = "01K70000000000000000000002";
const C = "01K70000000000000000000003";
const failedTest = "evidence 1 (node@24 vitest@5.0.3): The test exited with code 1, so the fact did not hold.";

describe("confirmedFailures", () => {
  it("counts a failed test at once, and a source or an outage only on its second night", () => {
    const tonight = [
      result(A, "failed", [failedTest]),
      result(B, "failed", ["evidence 2 (source): That quote isn't on vitest.dev."]),
      result(C, "failed", ["evidence 1 (node@24 vitest@5.0.3): Could not install vitest@5.0.3."]),
    ];
    expect(confirmedFailures(tonight, undefined).map((f) => f.id)).toEqual([A]);
    expect(confirmedFailures(tonight, [result(B, "failed", ["x"]), result(C, "passed")]).map((f) => f.id)).toEqual([A, B]);
  });

  it("ignores passing and skipped lessons", () => {
    expect(confirmedFailures([result(A, "passed"), result(B, "skipped", ["skip: old runtime"])], undefined)).toEqual([]);
  });

  it("treats sources, installs, Docker errors, and timeouts as possible outages", () => {
    expect(isTransient("evidence 3 (source): The page did not answer within 5 seconds.")).toBe(true);
    expect(isTransient("evidence 1 (node@24): Could not start Docker (spawn docker ENOENT). Install Docker, or run without --run.")).toBe(true);
    expect(isTransient("evidence 1 (node@24): The test ran too long (30 seconds, or 90 with packages). Make it finish faster and work offline.")).toBe(true);
    expect(isTransient("evidence 1 (node@24): The test exited with code 125, so the fact did not hold.")).toBe(true);
    expect(isTransient(failedTest)).toBe(false);
  });
});

describe("decide", () => {
  it("withholds nothing when too many lessons fail at once", () => {
    const many = Array.from({ length: 10 }, (_, i) => result(`01K7000000000000000000001${i}`, "failed", [failedTest]));
    expect(decide(many, undefined, new Date("2026-10-12T04:40:00Z"))).toEqual({ checked_at: "2026-10-12T04:40:00Z", failing: [], suspended: { failed: 10, checked: 10 } });
    // A suspended night keeps last night's list: lessons already confirmed failing stay withheld.
    const kept = [{ id: A, file: `lessons/x/${A}.json`, reasons: [failedTest] }];
    expect(decide(many, undefined, new Date(), kept).failing).toEqual(kept);
    expect(decide([result(A, "failed", [failedTest]), result(B, "passed")], undefined, new Date()).failing.map((f) => f.id)).toEqual([A]);
  });

  it("calls more than 3 failures and more than a fifth of all too many", () => {
    expect(tooMany(3, 4)).toBe(false);
    expect(tooMany(4, 30)).toBe(false);
    expect(tooMany(7, 30)).toBe(true);
  });
});

describe("safeFailing", () => {
  it("keeps only a lesson id at its own path", () => {
    expect(safeFailing({ id: A, file: `lessons/vitest/${A}.json`, reasons: ["x", 3 as unknown as string] })).toEqual({ id: A, file: `lessons/vitest/${A}.json`, reasons: ["x"] });
    expect(safeFailing({ id: A, file: `lessons/vitest/${B}.json` })).toBeUndefined();
    expect(safeFailing({ id: A, file: `--force` })).toBeUndefined();
    expect(safeFailing({ id: A, file: `lessons/../.github/${A}.json` })).toBeUndefined();
    expect(safeFailing({ id: "../x", file: "lessons/x/../x.json" })).toBeUndefined();
  });
});

describe("retractionIssue", () => {
  it("fences what failed as text, links the prepared branch, and says closing stops the reports", () => {
    const { title, body } = retractionIssue({ id: A, file: `lessons/x/${A}.json`, reasons: ["```\n# Heading\n[link](https://evil.example)"] }, "o/r", "https://github.com/o/r/actions/runs/1");
    expect(title).toBe(`Retract ${A}: its evidence fails the nightly check`);
    expect(body).toContain("```text\n'''\n# Heading");
    expect(body.match(/```/g)!.length).toBe(2);
    expect(body).toContain(`https://github.com/o/r/compare/main...retract/${A}?expand=1`);
    expect(body).toContain("Closing it stops these reports");
  });
});
