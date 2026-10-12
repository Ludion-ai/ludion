import { describe, expect, it } from "vitest";
import { parseAddedLog, parseDeletedLog } from "../src/build/git-info.ts";
import { modelTotals, type Models } from "../src/build/models.ts";
import { reservedSubjects } from "../src/build/data.ts";
import { teacherPages } from "../src/build/teacher-pages.ts";

const R = "\x1e";
const F = "\x1f";

describe("parseAddedLog", () => {
  it("takes verified_at and the PR number from the commit that added each lesson", () => {
    const log = [
      `${R}2026-10-09T10:00:00+09:00${F}Teach node: something (#42)`,
      "",
      "lessons/node/01K70000000000000000000002.json",
      `${R}2026-10-07T11:40:25Z${F}Add v0 spec`,
      "",
      "lessons/python/01K6ZQ4T9X0N8V2H7M3P5R1S6W.json",
      "lessons/lessons.schema.json",
      "",
    ].join("\n");
    expect(parseAddedLog(log)).toEqual({
      "01K70000000000000000000002": { verified_at: "2026-10-09T01:00:00Z", pr: 42 },
      "01K6ZQ4T9X0N8V2H7M3P5R1S6W": { verified_at: "2026-10-07T11:40:25Z", pr: null },
    });
  });

  it("keeps the newest addition when a file was added twice", () => {
    const log = `${R}2026-10-09T00:00:00Z${F}Re-add (#9)\nlessons/x/01K70000000000000000000003.json\n${R}2026-10-01T00:00:00Z${F}Add (#3)\nlessons/x/01K70000000000000000000003.json\n`;
    expect(parseAddedLog(log)["01K70000000000000000000003"]).toEqual({ verified_at: "2026-10-09T00:00:00Z", pr: 9 });
  });
});

describe("teacherPages", () => {
  it("gives each teacher a page at their lowercase login", () => {
    expect(teacherPages(new Map([[1, "Alice"], [2, "bob"]]), new Set([1, 2]))).toEqual(new Map([["alice", 1], ["bob", 2]]));
  });

  it("on a name clash, gives the page to the id whose login came from the API", () => {
    // Id 1 renamed away from "sam" (lookup failed, so we only have the stored name); id 2 now holds "Sam".
    expect(teacherPages(new Map([[1, "sam"], [2, "Sam"]]), new Set([2]))).toEqual(new Map([["sam", 2]]));
  });

  it("gives the page to no one when neither login came from the API", () => {
    expect(teacherPages(new Map([[1, "sam"], [2, "Sam"]]), new Set())).toEqual(new Map());
  });
});

describe("parseDeletedLog", () => {
  it("finds each retracted lesson's newest deletion, with the commit to read it from", () => {
    const log = [
      `${R}abc123${F}2026-10-12T03:00:00Z${F}Retract a lesson whose quote is gone (#51)`,
      "",
      "lessons/vitest/01K70000000000000000000004.json",
      `${R}def456${F}2026-10-10T00:00:00Z${F}Retract (#40)`,
      "lessons/vitest/01K70000000000000000000004.json",
      "lessons/lessons.schema.json",
    ].join("\n");
    expect(parseDeletedLog(log)).toEqual({
      "01K70000000000000000000004": { path: "lessons/vitest/01K70000000000000000000004.json", commit: "abc123", retracted_at: "2026-10-12T03:00:00Z", pr: 51 },
    });
  });
});

describe("reservedSubjects", () => {
  it("names subjects that a top-level page would shadow", () => {
    expect(reservedSubjects(["vitest", "models", "start", "vitest"])).toEqual(["models", "start"]);
  });
});

describe("modelTotals", () => {
  it("counts only measured lessons that are still active", () => {
    const models: Models = {
      measured_at: "2026-10-11",
      bench: "docs/bench/x/",
      method: "",
      models: { a: { name: "A" }, b: { name: "B" } },
      lessons: { L1: { a: "knows", b: "misses" }, L2: { a: "misses" }, GONE: { a: "knows", b: "knows" } },
    };
    expect(modelTotals(models, new Set(["L1", "L2", "L3"]))).toEqual([
      { id: "a", name: "A", knows: 1, misses: 1 },
      { id: "b", name: "B", knows: 0, misses: 1 },
    ]);
  });
});