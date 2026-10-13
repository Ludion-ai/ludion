import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { readDone3 } from "../src/build/bench.ts";
import { homeComparison } from "../src/build/home.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const recorded = readDone3(root)!;

describe("the recorded home comparison", () => {
  it("shows literal answer excerpts with their recorded grades and existing run URLs", () => {
    const example = homeComparison(recorded)!;
    expect(example.question).toBe("Do I need extends: true for each inline project to pick up my root Vitest settings?");
    expect(example.measuredAt).toBe("2026-10-11");
    expect(example.before.grade).toBe("wrong");
    expect(example.after.grade).toBe("correct");
    expect(example.before.answer.startsWith(example.before.excerpt)).toBe(true);
    expect(example.after.answer.startsWith(example.after.excerpt)).toBe(true);
    expect(example.before.excerpt.startsWith("Yes.")).toBe(true);
    expect(example.after.excerpt.startsWith("No.")).toBe(true);
    expect(example.after.excerpt).toContain("5.0.3");
    expect(example.before.href).toBe(`/bench/${example.model}/vitest-5-0-0-14-b-without-sync/`);
    expect(example.after.href).toBe(`/bench/${example.model}/vitest-5-0-0-14-b-with-sync/`);
  });

  it("shows nothing when evidence is missing", () => {
    expect(homeComparison(null)).toBeNull();
    const changed = structuredClone(recorded);
    changed.runs = changed.runs.filter((r) => !r.sync);
    expect(homeComparison(changed)).toBeNull();
  });

  it("does not join answers from different models", () => {
    const changed = structuredClone(recorded);
    changed.runs.find((r) => r.sync)!.model = "a-different-model";
    expect(homeComparison(changed)).toBeNull();
  });

  it("does not present an errored run as a successful answer", () => {
    const changed = structuredClone(recorded);
    changed.runs.find((r) => r.sync)!.answers.find((a) => a.id === "vitest-5-0-0-14-b")!.isError = true;
    expect(homeComparison(changed)).toBeNull();
  });

  it("does not show an improvement when the recorded grade no longer supports it", () => {
    const changed = structuredClone(recorded);
    changed.runs.find((r) => r.sync)!.grades.find((g) => g.id === "vitest-5-0-0-14-b")!.grade = "wrong";
    expect(homeComparison(changed)).toBeNull();
  });
});
