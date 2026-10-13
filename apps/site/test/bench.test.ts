import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { benchJson, done3Misses, done3Table, readDone3, readSteps, wilson, withoutToolsTable, type Done3 } from "../src/build/bench.ts";
import { readModels, type Models } from "../src/build/models.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const done3 = readDone3(root)!;
const models = readModels(root)!;
const dir = join(root, done3.dir);
const raw = <T>(file: string): T => JSON.parse(readFileSync(join(dir, file), "utf8")) as T;

describe("wilson", () => {
  it("gives the 95% Wilson interval", () => {
    // 0 of 10: the upper bound is z²/(n+z²).
    const [lo, hi] = wilson(0, 10);
    expect(lo).toBe(0);
    expect(hi).toBeCloseTo(3.8415 / 13.8415, 4);
    // Symmetric around 1/2 for k = n/2.
    const [a, b] = wilson(5, 10);
    expect(a + b).toBeCloseTo(1, 10);
    expect(a).toBeCloseTo(0.2366, 4);
  });
});

describe("the /bench numbers match docs/bench", () => {
  it("counts each Done 3 cell from the grades files, per subject and over all", () => {
    const questions = raw<{ id: string; library: string; set: string }[]>("questions.json").filter((q) => q.set === "B");
    const table = done3Table(done3, models);
    for (const label of ["B-project", "B-project-sync"]) {
      const grades = raw<{ grades: { id: string; grade: string }[] }>(`grades-${label}.json`).grades;
      const correct = new Set(grades.filter((g) => g.grade === "correct").map((g) => g.id));
      const row = table.rows.find((r) => r.measured && r.run === label);
      if (!row?.measured) throw new Error(`no row for ${label}`);
      for (const column of table.columns) {
        const qs = questions.filter((q) => column === "all" || q.library === column);
        expect(row.cells[column]!.total, `${label} ${column}`).toBe(qs.length);
        expect(row.cells[column]!.correct, `${label} ${column}`).toBe(qs.filter((q) => correct.has(q.id)).length);
      }
    }
  });

  it("agrees with the official result in the Done 3 README", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    const m = /^## B questions: (\d+)\/(\d+) with sync, (\d+)\/(\d+) without/m.exec(readme);
    expect(m).not.toBeNull();
    const rows = done3Table(done3, models).rows;
    const all = (sync: boolean) => {
      const r = rows.find((x) => x.measured && x.sync === sync);
      return r?.measured ? [r.cells.all!.correct, r.cells.all!.total] : null;
    };
    expect(all(true)).toEqual([Number(m![1]), Number(m![2])]);
    expect(all(false)).toEqual([Number(m![3]), Number(m![4])]);
  });

  it("sums each run's cost from its answers and grades", () => {
    const sum = (xs: { costUsd: number }[]) => xs.reduce((t, x) => t + x.costUsd, 0);
    for (const run of done3.runs) {
      expect(run.answerUsd).toBeCloseTo(sum(raw<{ answers: { costUsd: number }[] }>(`answers-${run.label}.json`).answers), 10);
      expect(run.judgeUsd).toBeCloseTo(sum(raw<{ grades: { costUsd: number }[] }>(`grades-${run.label}.json`).grades), 10);
    }
  });

  it("counts the without-tools cells from models.json", () => {
    const subjectOf = new Map(Object.keys(models.lessons).map((id, i) => [id, i % 2 ? "x" : "y"]));
    const t = withoutToolsTable(models, subjectOf);
    for (const [model] of Object.entries(models.models)) {
      const row = t.rows.find((r) => r.model === model);
      if (!row?.measured) throw new Error(`no row for ${model}`);
      const verdicts = Object.values(models.lessons).map((v) => v[model]).filter(Boolean);
      expect(row.cells.all).toMatchObject({ correct: verdicts.filter((v) => v === "knows").length, total: verdicts.length });
    }
  });

  it("lists every question a model didn't get right, with the change's seed lesson", () => {
    const seeds = raw<Record<string, string>>("seeds.json");
    for (const { run, misses } of done3Misses(done3, "claude-opus-5-5")) {
      expect(misses.length).toBe(run.grades.filter((g) => g.grade !== "correct").length);
      for (const m of misses) expect(m.lesson).toBe(seeds[m.question.change] ?? null);
    }
  });
});

describe("models without a run", () => {
  it("get one not-measured row each, after the measured ones", () => {
    const rows = done3Table(done3, models).rows;
    const measured = new Set(done3.runs.map((r) => r.model));
    for (const id of Object.keys(models.models).filter((id) => !measured.has(id))) {
      expect(rows.filter((r) => r.model === id)).toEqual([{ model: id, name: models.models[id]!.name, measured: false }]);
    }
    expect(rows.findIndex((r) => !r.measured)).toBeGreaterThan(rows.findLastIndex((r) => r.measured));
  });

  it("show as not measured with no numbers, when nothing has been run", () => {
    const only: Models = { ...models, models: { "model-x": { name: "Model X" } }, lessons: {} };
    expect(done3Table(null, only).rows).toEqual([{ model: "model-x", name: "Model X", measured: false }]);
    expect(withoutToolsTable(only, new Map()).rows).toEqual([{ model: "model-x", name: "Model X", measured: false }]);
    const empty: Done3 = { ...done3, runs: [] };
    expect(benchJson(empty, only, new Map(), "https://github.com/o/r").done3?.rows).toEqual([{ model: "model-x", name: "Model X", measured: false }]);
  });

  const page = join(root, "apps/site/dist/bench/index.html");
  it.skipIf(!existsSync(page))("say so on the built /bench page", () => {
    const html = readFileSync(page, "utf8");
    const unmeasured = Object.keys(models.models).filter((id) => !done3.runs.some((r) => r.model === id));
    expect(unmeasured.length).toBeGreaterThan(0);
    for (const id of unmeasured) {
      const row = new RegExp(String.raw`<tr[^>]*>\s*<th[^>]*>\s*<a href="/bench/${id}/"[^>]*>[^<]*</a>\s*</th>\s*<td[^>]*>Not measured</td>`).exec(html);
      expect(row, id).not.toBeNull();
    }
  });
});

const cards = join(root, "apps/site/dist/bench/og");
describe.skipIf(!existsSync(cards))("share cards", () => {
  it("exist for every model page that names one", () => {
    const pages = readdirSync(cards, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(pages.length).toBeGreaterThan(0);
    for (const id of pages) expect(existsSync(join(cards, `${id}.png`)), id).toBe(true);
  });
});

describe("readSteps", () => {
  it("keeps the agent's text, its tool calls, and their output, and nothing else", () => {
    const log = [
      JSON.stringify({ type: "system", subtype: "init", cwd: "C:\Users\someone" }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking: "x" }, { type: "tool_use", name: "Grep", input: { pattern: "ai" } }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "<script>alert(1)</script>" }] }] } }),
      "not json",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }),
    ].join("\n");
    expect(readSteps(log)).toEqual([
      { kind: "tool", name: "Grep", input: JSON.stringify({ pattern: "ai" }, null, 2) },
      { kind: "result", text: "<script>alert(1)</script>", truncated: false, error: false },
      { kind: "text", text: "Done." },
    ]);
  });
});
