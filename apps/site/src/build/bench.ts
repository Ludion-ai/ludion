// FreshBench results for /bench (docs/bench/). Runs in Node at build time only. Every number on /bench comes from
// here, and everything here is read from docs/bench: the Done 3 run's questions, answers, and grades, and models.json.
// Nothing is estimated or typed in by hand; a model with no run has no numbers, only "not measured".
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Models } from "./models.ts";

export { daysBetween } from "./days.ts";

/** The official Done 3 run (docs/decisions.md, "Measuring Done 3"): B questions, frozen seeds, with and without sync. */
export const DONE3_DIR = "docs/bench/2026-10-11-done3";

export type Grade = "correct" | "wrong" | "no_answer";

export interface BenchQuestion {
  id: string;
  library: string;
  change: string;
  set: "A" | "B";
  question: string;
  answer: string;
  accept: string;
  reject: string;
  quote: string;
  url: string;
  signal?: "loud" | "silent";
  symbol?: string;
}

export interface BenchAnswer {
  id: string;
  answer: string;
  toolCalls: unknown[];
  costUsd: number;
  turns: number;
  isError: boolean;
}

export interface BenchGrade {
  id: string;
  grade: Grade;
  why: string;
  costUsd: number;
}

/** One measured run: one model answering one question set under one condition, then judged. */
export interface BenchRun {
  /** The run's label in its file names (answers-<label>.json, runs/<label>/). */
  label: string;
  /** "with-sync" or "without-sync": the run's part of a run page's path. */
  slug: string;
  model: string;
  set: "A" | "B";
  condition: string;
  sync: boolean;
  /** The agent could search and fetch the web (the project condition allows WebSearch and WebFetch). */
  webSearch: boolean;
  answers: BenchAnswer[];
  grades: BenchGrade[];
  answerUsd: number;
  judgeUsd: number;
}

export interface Done3 {
  /** Repo-relative folder, for links to the files. */
  dir: string;
  /** YYYY-MM-DD, from the folder's name. */
  measuredAt: string;
  questions: BenchQuestion[];
  /** Change id → the seed lesson that covered it at the frozen commit. */
  seeds: Record<string, string>;
  runs: BenchRun[];
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const sum = (xs: { costUsd: number }[]) => xs.reduce((t, x) => t + x.costUsd, 0);

/**
 * The tools each FreshBench condition gives the agent (tools/bench/src/agent.ts). project: Claude Code's default
 * read-only tools in a project with the new versions installed, web search included. none: no tools.
 */
const CONDITIONS: Record<string, { webSearch: boolean }> = {
  none: { webSearch: false },
  web: { webSearch: true },
  project: { webSearch: true },
};

/** The Done 3 run's B questions and both conditions, or null if its files aren't there. */
export function readDone3(root: string, dir = DONE3_DIR): Done3 | null {
  const abs = join(root, dir);
  if (!existsSync(join(abs, "questions.json"))) return null;
  const measuredAt = /(\d{4}-\d{2}-\d{2})/.exec(dir)?.[1];
  if (!measuredAt) throw new Error(`${dir}: the folder name has no date.`);
  const runs: BenchRun[] = [];
  for (const label of ["B-project", "B-project-sync"]) {
    const answersPath = join(abs, `answers-${label}.json`);
    const gradesPath = join(abs, `grades-${label}.json`);
    if (!existsSync(answersPath) || !existsSync(gradesPath)) continue;
    const a = readJson<{ set: "A" | "B"; condition: string; model: string; answers: BenchAnswer[] }>(answersPath);
    const g = readJson<{ grades: BenchGrade[] }>(gradesPath);
    const condition = CONDITIONS[a.condition];
    if (!condition) throw new Error(`${answersPath}: unknown condition ${a.condition}.`);
    const sync = label.endsWith("-sync");
    runs.push({
      label,
      slug: sync ? "with-sync" : "without-sync",
      model: a.model,
      set: a.set,
      condition: a.condition,
      sync,
      webSearch: condition.webSearch,
      answers: a.answers,
      grades: g.grades,
      answerUsd: sum(a.answers),
      judgeUsd: sum(g.grades),
    });
  }
  const questions = readJson<BenchQuestion[]>(join(abs, "questions.json")).filter((q) => runs.some((r) => q.set === r.set));
  return { dir, measuredAt, questions, seeds: readJson<Record<string, string>>(join(abs, "seeds.json")), runs };
}

/** 95% Wilson score interval for k successes out of n, as fractions. */
export function wilson(k: number, n: number, z = 1.959963984540054): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n;
  const z2 = z * z;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denom = 1 + z2 / n;
  return [Math.max(0, (center - margin) / denom), Math.min(1, (center + margin) / denom)];
}

export interface Cell {
  correct: number;
  total: number;
  /** 95% Wilson interval, as fractions. */
  low: number;
  high: number;
}

export function cell(correct: number, total: number): Cell {
  const [low, high] = wilson(correct, total);
  return { correct, total, low, high };
}

export type Row =
  | { model: string; name: string; measured: true; run: string; slug: string; sync: boolean; webSearch: boolean; cells: Record<string, Cell> }
  | { model: string; name: string; measured: false };

export interface Table {
  /** Column keys: the subjects, then "all". */
  columns: string[];
  rows: Row[];
}

const nameOf = (models: Models | null, id: string) => models?.models[id]?.name ?? id;

/** Every model id /bench has a page for: the ones in models.json, then any other model a Done 3 run used. */
export function benchModels(done3: Done3 | null, models: Models | null): { id: string; name: string }[] {
  const ids = [...Object.keys(models?.models ?? {}), ...(done3?.runs.map((r) => r.model) ?? [])];
  return [...new Set(ids)].map((id) => ({ id, name: nameOf(models, id) }));
}

/**
 * The Done 3 table: per model and condition, correct answers out of questions, per subject and over all of them.
 * Models measured come first (without sync, then with); models without a run get one "not measured" row.
 */
export function done3Table(done3: Done3 | null, models: Models | null): Table {
  const subjects = [...new Set(done3?.questions.map((q) => q.library) ?? [])].sort();
  const columns = [...subjects, "all"];
  const measured: Row[] = [];
  const unmeasured: Row[] = [];
  for (const { id, name } of benchModels(done3, models)) {
    const runs = (done3?.runs ?? []).filter((r) => r.model === id).sort((a, b) => Number(a.sync) - Number(b.sync));
    if (!runs.length) {
      unmeasured.push({ model: id, name, measured: false });
      continue;
    }
    for (const r of runs) {
      const grades = new Map(r.grades.map((g) => [g.id, g.grade]));
      const cells: Record<string, Cell> = {};
      for (const column of columns) {
        const qs = done3!.questions.filter((q) => column === "all" || q.library === column);
        cells[column] = cell(qs.filter((q) => grades.get(q.id) === "correct").length, qs.length);
      }
      measured.push({ model: id, name, measured: true, run: r.label, slug: r.slug, sync: r.sync, webSearch: r.webSearch, cells });
    }
  }
  return { columns, rows: [...measured, ...unmeasured] };
}

/**
 * The models.json table (FreshBench A questions, no tools): per model, the measured lessons whose change it knows
 * (answered right twice), per subject. Only lessons in `subjectOf` (the active ones) count, as on the old /models.
 */
export function withoutToolsTable(models: Models | null, subjectOf: Map<string, string>): Table {
  const measuredIds = Object.keys(models?.lessons ?? {}).filter((id) => subjectOf.has(id));
  const subjects = [...new Set(measuredIds.map((id) => subjectOf.get(id)!))].sort();
  const columns = [...subjects, "all"];
  const rows: Row[] = Object.entries(models?.models ?? {}).map(([model, { name }]) => {
    const verdicts = measuredIds.filter((id) => models!.lessons[id]![model]);
    if (!verdicts.length) return { model, name, measured: false };
    const cells: Record<string, Cell> = {};
    for (const column of columns) {
      const ids = verdicts.filter((id) => column === "all" || subjectOf.get(id) === column);
      cells[column] = cell(ids.filter((id) => models!.lessons[id]![model] === "knows").length, ids.length);
    }
    return { model, name, measured: true, run: "A-none", slug: "", sync: false, webSearch: false, cells };
  });
  return { columns, rows };
}

export interface Miss {
  question: BenchQuestion;
  grade: Exclude<Grade, "correct">;
  why: string;
  /** The change's seed lesson, if Done 3 had one for it. */
  lesson: string | null;
  run: BenchRun;
}

/** The questions a model didn't get right in each of its Done 3 runs, in question order. */
export function done3Misses(done3: Done3 | null, model: string): { run: BenchRun; misses: Miss[] }[] {
  if (!done3) return [];
  return done3.runs
    .filter((r) => r.model === model)
    .sort((a, b) => Number(a.sync) - Number(b.sync))
    .map((run) => {
      const grades = new Map(run.grades.map((g) => [g.id, g]));
      const misses: Miss[] = [];
      for (const question of done3.questions) {
        const g = grades.get(question.id);
        if (!g || g.grade === "correct") continue;
        misses.push({ question, grade: g.grade, why: g.why, lesson: done3.seeds[question.change] ?? null, run });
      }
      return { run, misses };
    });
}

/** Run page path segment: the question and the run's condition. */
export const runSlug = (questionId: string, run: Pick<BenchRun, "slug">) => `${questionId}-${run.slug}`;

/** One step of an agent's session, as its raw log recorded it. */
export type Step =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; input: string }
  | { kind: "result"; text: string; truncated: boolean; error: boolean };

/** Longest tool output shown on a run page; the whole log is on GitHub. */
export const MAX_OUTPUT = 20_000;

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === "object" && "text" in c && typeof c.text === "string" ? c.text : JSON.stringify(c))).join("\n");
  }
  return JSON.stringify(content ?? "");
}

/**
 * The steps of one session log (runs/<label>/<question>.jsonl, Claude Code's stream-json output): what the agent
 * wrote, each tool it called with its input, and what the tool returned. The init line, thinking, and rate-limit
 * events are left out. Everything stays text: it is rendered escaped, never as HTML.
 */
export function readSteps(jsonl: string): Step[] {
  const steps: Step[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let event: { type?: string; message?: { content?: unknown } };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (event.type === "assistant" && block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        steps.push({ kind: "text", text: block.text });
      } else if (event.type === "assistant" && block.type === "tool_use") {
        steps.push({ kind: "tool", name: String(block.name), input: JSON.stringify(block.input ?? {}, null, 2) });
      } else if (event.type === "user" && block.type === "tool_result") {
        const text = resultText(block.content);
        steps.push({ kind: "result", text: text.slice(0, MAX_OUTPUT), truncated: text.length > MAX_OUTPUT, error: block.is_error === true });
      }
    }
  }
  return steps;
}

/** The session log of one question in one run, or null if the file isn't there. */
export function readRunLog(root: string, done3: Done3, run: BenchRun, questionId: string): { path: string; steps: Step[] } | null {
  const path = `${done3.dir}/runs/${run.label}/${questionId}.jsonl`;
  const abs = join(root, path);
  return existsSync(abs) ? { path, steps: readSteps(readFileSync(abs, "utf8")) } : null;
}

/**
 * The one-line command that reruns the Done 3 runs (tools/bench/src/projects.ts, then freshbench.ts run and judge).
 * The part in brackets is the run with sync.
 */
export function reproduceCommand(done3: Done3): string {
  const run = done3.runs[0]!;
  const q = `${done3.dir}/questions.json`;
  const label = run.label.replace(/-sync$/, "");
  return `node tools/bench/src/projects.ts <projects> && node tools/bench/src/freshbench.ts run ${q} <out> ${label}[-sync] --set ${run.set} --condition ${run.condition} --projects <projects> --model ${run.model} [--sync packages/cli/dist/cli.js --ludion-home <empty dir>] && node tools/bench/src/freshbench.ts judge ${q} <out> ${label}[-sync]`;
}

/** What /bench.json serves: the two tables and where their numbers come from. */
export function benchJson(done3: Done3 | null, models: Models | null, subjectOf: Map<string, string>, repo: string) {
  const rowJson = (r: Row) =>
    r.measured
      ? { model: r.model, name: r.name, measured: true, run: r.run, sync: r.sync, web_search: r.webSearch, cells: r.cells }
      : { model: r.model, name: r.name, measured: false };
  const t = done3Table(done3, models);
  const w = withoutToolsTable(models, subjectOf);
  return {
    interval: "95% Wilson score interval; low and high are fractions",
    done3: done3 && {
      measured_at: done3.measuredAt,
      files: `${repo}/tree/main/${done3.dir}`,
      questions: `FreshBench ${done3.runs[0]?.set ?? "B"} questions, one per change`,
      tools: "Claude Code's default read-only tools, in a project with the new versions installed",
      columns: t.columns,
      rows: t.rows.map(rowJson),
    },
    without_tools: models && {
      measured_at: models.measured_at,
      files: `${repo}/tree/main/${models.bench}`,
      method: models.method,
      unit: "lessons whose change the model knows (both answers correct) out of measured, active lessons",
      columns: w.columns,
      rows: w.rows.map(rowJson),
    },
  };
}
