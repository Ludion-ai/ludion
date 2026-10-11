import { describe, expect, it } from "vitest";
import { confirmedFailures, isTransient, retractionPr } from "../src/reverify.ts";
import type { LessonResult } from "../src/verify.ts";

const result = (id: string, status: LessonResult["status"], reasons: string[] = []): LessonResult => ({ file: `lessons/x/${id}.json`, id, claim: "c", status, reasons, labels: [] });
const A = "01K70000000000000000000001";
const B = "01K70000000000000000000002";
const C = "01K70000000000000000000003";

describe("confirmedFailures", () => {
  it("counts a failed test at once, and a source or an outage only on its second night", () => {
    const tonight = [
      result(A, "failed", ["evidence 1 (node@24 vitest@5.0.3): The test exited with code 1, so the fact did not hold."]),
      result(B, "failed", ["evidence 2 (source): That quote isn't on vitest.dev."]),
      result(C, "failed", ["evidence 1 (node@24 vitest@5.0.3): Could not install vitest@5.0.3."]),
    ];
    expect(confirmedFailures(tonight, undefined).map((f) => f.id)).toEqual([A]);
    expect(confirmedFailures(tonight, [result(B, "failed", ["x"]), result(C, "passed")]).map((f) => f.id)).toEqual([A, B]);
  });

  it("ignores passing and skipped lessons", () => {
    expect(confirmedFailures([result(A, "passed"), result(B, "skipped", ["skip: old runtime"])], undefined)).toEqual([]);
  });

  it("knows which reasons might be an outage", () => {
    expect(isTransient("evidence 3 (source): The page did not answer within 5 seconds.")).toBe(true);
    expect(isTransient("evidence 1 (node@24): Could not start Docker (spawn docker ENOENT). Install Docker, or run without --run.")).toBe(true);
    expect(isTransient("evidence 1 (node@24): The test exited with code 1, so the fact did not hold.")).toBe(false);
  });
});

describe("retractionPr", () => {
  it("fences what failed as text, so lesson output can't become markdown or close the fence", () => {
    const { title, body } = retractionPr({ id: A, file: `lessons/x/${A}.json`, reasons: ["```\n# Heading\n[link](https://evil.example)"] }, "https://github.com/o/r/actions/runs/1");
    expect(title).toBe(`Retract ${A}: its evidence no longer holds`);
    expect(body).toContain("```text\n'''\n# Heading");
    expect(body.match(/```/g)!.length).toBe(2);
    expect(body).toContain("close and reopen this PR to run them");
  });
});
