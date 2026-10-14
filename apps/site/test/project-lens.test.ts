import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildIndex, validateLesson, type Lesson } from "@ludion/core";
import { describe, expect, it } from "vitest";
import { projectLens } from "../src/build/project-lens.ts";
import { readModels } from "../src/build/models.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const lessons: Lesson[] = [];
for (const subject of readdirSync(join(root, "lessons"), { withFileTypes: true })) {
  if (!subject.isDirectory()) continue;
  for (const file of readdirSync(join(root, "lessons", subject.name))) {
    if (!file.endsWith(".json")) continue;
    const result = validateLesson(JSON.parse(readFileSync(join(root, "lessons", subject.name, file), "utf8")));
    if (!result.ok) throw new Error(`Invalid lesson ${file}`);
    lessons.push(result.lesson);
  }
}
const index = buildIndex(lessons, {}, new Map(), { org: "Ludion-ai", repo: "ludion" });
const models = readModels(root)!;
const CONFIG = "01M4N6Y54270A8AKTMH9SVGV32";
const EXTENDS = "01M4N4KZ0QT41TY27SW0E683RX";

describe("the explorable project selection", () => {
  it("uses installed ranges and only prunes a measured knows verdict", () => {
    const lens = projectLens(index, models);
    expect(lens.defaultModel).toBe("claude-haiku-5-5");
    const opus = lens.cases.find((item) => item.project.id === "vitest-5" && item.model === "claude-opus-5-5")!;
    const haiku = lens.cases.find((item) => item.project.id === "vitest-5" && item.model === "claude-haiku-5-5")!;
    const older = lens.cases.find((item) => item.project.id === "vitest-4" && item.model === "claude-opus-5-5")!;
    expect(opus.preview.find((lesson) => lesson.entry.id === EXTENDS)).toMatchObject({ included: true, verdict: "misses" });
    expect(opus.preview.find((lesson) => lesson.entry.id === CONFIG)).toMatchObject({ included: true, verdict: "misses" });
    expect(haiku.preview.find((lesson) => lesson.entry.id === CONFIG)).toMatchObject({ included: false, verdict: "knows" });
    expect(haiku.pruned).toBe(opus.pruned + 1);
    expect(haiku.included).toBe(opus.included - 1);
    expect(haiku.matched).toBe(opus.matched);
    expect(opus.matched).toBe(opus.included + opus.pruned);
    expect(older.preview.some((lesson) => lesson.entry.id === EXTENDS)).toBe(false);
    expect(older.matched).toBeLessThan(opus.matched);
  });

  it("retains unmeasured lessons, their literal claims, teacher identity, and draft labels", () => {
    const lens = projectLens(index, models);
    const example = lens.cases.find((item) => item.project.id === "vitest-5" && item.model === lens.defaultModel)!;
    const unmeasured = example.preview.find((lesson) => lesson.verdict === null)!;
    expect(unmeasured.included).toBe(true);
    expect(unmeasured.entry).toBe(index.lessons.find((entry) => entry.id === unmeasured.entry.id));
    expect(unmeasured.entry.drafted_by).toBe("agent");
    expect(unmeasured.entry.teacher).toBeTruthy();
    expect(unmeasured.entry.teacher_id).toBeGreaterThan(0);
    expect(example.unmeasured).toBeGreaterThan(0);
  });

  it("uses only the supplied active index and remains honest with no model measurements", () => {
    const reduced = { ...index, lessons: index.lessons.filter((entry) => entry.id !== CONFIG) };
    const lens = projectLens(reduced, null);
    expect(lens.measuredAt).toBeNull();
    expect(lens.models).toEqual([{ id: "", name: "" }]);
    for (const item of lens.cases) {
      expect(item.preview.some((lesson) => lesson.entry.id === CONFIG)).toBe(false);
      expect(item.pruned).toBe(0);
      expect(item.included).toBe(item.matched);
      expect(item.unmeasured).toBe(item.matched);
      expect(item.preview.every((lesson) => lesson.verdict === null)).toBe(true);
    }
  });
});
