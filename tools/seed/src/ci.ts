// Steps 6 and 7: CI's Docker results for the PR that carries the lessons, one repair round, and FreshBench labels with
// the harm check. Lesson code never runs on this machine: only CI's verify runs it (CLAUDE.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatLesson, lessonProblems, validateLessonV1 } from "@ludion/core";
import { runAgent } from "../../bench/src/agent.ts";
import { isLoss, JUDGE_PROMPT, lessonContext, MEASURED_MODELS, parseGrade, questionPrompt, type Grade } from "./bench.ts";
import type { Entry } from "./collect.ts";
import { draftPrompt, prepare } from "./draft.ts";
import { read, write, type RunInfo } from "./io.ts";
import { agentIn, ask, CONTENT_MODEL, extractJson, pool, WORK_MODEL } from "./llm.ts";
import { reviseRoute, type Finding } from "./review.ts";
import { CACHE, fetchText, gh, keptEntries, registryDoc, REPO_ROOT, safeName, sfx, toSeedLesson, type CheckRecord, type DraftRecord } from "./steps.ts";

export interface CiResult {
  id: string;
  entry: string;
  status: "passed" | "failed" | "skipped";
  reasons: string[];
}

interface Kept {
  entry: string;
  id: string;
}

/** Waits for the newest verify run on the PR's head, downloads its results, and records each lesson's result. */
export async function ci(dir: string, pr: string): Promise<void> {
  const kept = read<Kept[]>(dir, "kept.json");
  const byId = new Map(kept.map((k) => [k.id, k.entry]));
  const head = gh(["pr", "view", pr, "--json", "headRefOid", "--jq", ".headRefOid"]).trim();
  let runId = "";
  for (let i = 0; i < 120 && !runId; i++) {
    const runs = JSON.parse(gh(["run", "list", "--workflow", "verify.yml", "--commit", head, "--json", "databaseId,status", "--limit", "1"])) as { databaseId: number; status: string }[];
    if (runs[0]?.status === "completed") runId = String(runs[0].databaseId);
    else await new Promise((r) => setTimeout(r, 30_000));
  }
  if (!runId) throw new Error(`verify didn't finish on ${head} within an hour.`);
  const out = join(CACHE, "ci", runId);
  if (!existsSync(join(out, "results.json"))) gh(["run", "download", runId, "-n", "results", "-D", out]);
  const { results } = JSON.parse(readFileSync(join(out, "results.json"), "utf8")) as { results: { id?: string; status: CiResult["status"]; reasons: string[] }[] };
  const now: CiResult[] = results.filter((r) => r.id && byId.has(r.id)).map((r) => ({ id: r.id!, entry: byId.get(r.id!)!, status: r.status, reasons: r.reasons }));
  const rounds = existsSync(join(dir, "ci.json")) ? read<{ rounds: CiResult[][] }>(dir, "ci.json").rounds : [];
  write(dir, "ci.json", { rounds: [...rounds, now] });
  const passed = now.filter((r) => r.status === "passed").length;
  console.log(`ci (run ${runId}): ${now.length} lessons, ${passed} passed, ${now.length - passed} not.`);
}

/**
 * One repair round for lessons whose tests didn't pass in CI: the drafting agent gets its draft back with CI's reasons
 * and fixes it or skips. A fixed lesson keeps its id and file in `out` (the PR branch's lessons folder).
 */
export async function fix(dir: string, out: string, model = WORK_MODEL): Promise<void> {
  const run = read<RunInfo>(dir, "run.json");
  const entries = new Map(read<Entry[]>(dir, "entries.json").map((e) => [e.id, e]));
  const tags = new Map(read<{ version: string; tag: string }[]>(dir, "releases.json").map((r) => [r.version, r.tag]));
  const rounds = read<{ rounds: CiResult[][] }>(dir, "ci.json").rounds;
  const failed = rounds.at(-1)!.filter((r) => r.status !== "passed");
  const checks = new Map(read<CheckRecord[]>(dir, "check.json").map((c) => [c.entry, c]));
  const doc = await registryDoc(run.package);
  const fixes: { entry: string; id: string; outcome: string; cost_usd: number }[] = [];
  await pool(failed, 3, async (f) => {
    const entry = entries.get(f.entry)!;
    const { verdict } = read<DraftRecord>(join(dir, "drafts"), `${safeName(entry.id)}.json`);
    const prepared = await prepare({ run, entry, verdict, tag: tags.get(entry.version)!, all: Object.keys(doc.versions), directory: doc.repository?.directory, cache: CACHE, repoRoot: REPO_ROOT, gh, fetchText });
    const current = JSON.parse(readFileSync(join(out, run.package.replace(/^@/, "").replace("/", "."), `${f.id}.json`), "utf8")) as Record<string, unknown>;
    writeFileSync(join(prepared.folder, "draft.json"), JSON.stringify(current, null, 2));
    writeFileSync(join(prepared.folder, "CI.md"), ["# CI ran this draft's tests in Docker, and they did not pass", "", ...f.reasons].join("\n"));
    let work = "";
    const prompt = `${draftPrompt(run.package, prepared)}\n\ndraft.json already holds your earlier draft. CI.md says why its tests failed in CI's Docker run. Fix the draft so it is true and its tests pass, and overwrite draft.json; or replace it with {"skip": "<why>"} if no true, checkable lesson can be made.`;
    const r = await agentIn(prepared.folder, prompt, model, { prepare: (w) => (work = w) });
    const json = JSON.parse(readFileSync(join(work, "draft.json"), "utf8")) as Record<string, unknown>;
    if (typeof json.skip === "string") {
      fixes.push({ entry: f.entry, id: f.id, outcome: `skipped: ${json.skip}`, cost_usd: r.costUsd });
      return;
    }
    const lesson = toSeedLesson(json, new Date(String(current.created_at)), f.id);
    const v = validateLessonV1(lesson);
    const problems = v.ok ? lessonProblems(lesson) : v.errors.map((e) => `${e.path} ${e.message}`);
    if (problems.length) {
      fixes.push({ entry: f.entry, id: f.id, outcome: `still invalid: ${problems.join("; ")}`, cost_usd: r.costUsd });
      return;
    }
    writeFileSync(join(out, lesson.subject, `${lesson.id}.json`), formatLesson(lesson));
    fixes.push({ entry: f.entry, id: f.id, outcome: "fixed", cost_usd: r.costUsd });
  });
  write(dir, `fix-${rounds.length}.json`, fixes);
  console.log(`fix: ${failed.length} lessons failed in CI, ${fixes.filter((x) => x.outcome === "fixed").length} rewritten.`);
}

/** A question per lesson, each measured model's answer without tools, and opus again with the lesson (the harm check). */
export async function bench(dir: string, lessonsDir: string): Promise<void> {
  const entries = new Map(read<Entry[]>(dir, "entries.json").map((e) => [e.id, e]));
  const final = read<Kept[]>(dir, existsSync(join(dir, "final.json")) ? "final.json" : "kept.json");
  const run = read<RunInfo>(dir, "run.json");
  const prior = existsSync(join(dir, "bench.json")) ? read<{ id: string; loss: boolean }[]>(dir, "bench.json") : [];
  const done = new Set(prior.map((b) => b.id));
  const out: unknown[] = [...prior];
  const { generateClaim } = await import("@ludion/core");
  await pool(final.filter((k) => !done.has(k.id)), 3, async (k) => {
    const lesson = JSON.parse(readFileSync(join(lessonsDir, run.package.replace(/^@/, "").replace("/", "."), `${k.id}.json`), "utf8"));
    const claim = generateClaim(lesson);
    const q = extractJson((await ask(questionPrompt(lesson, entries.get(k.entry)!.text), WORK_MODEL, 1)).answer) as { question: string; answer: string; accept: string; reject: string };
    const src = lesson.evidence.find((e: object) => "source" in e);
    const question = { id: k.id, library: run.package, change: k.entry, set: "B" as const, ...q, quote: src?.source.quote ?? "", url: src?.source.url ?? "" };
    const prompt = `${question.question}\n\nAnswer in a few sentences.`;
    const grade = async (answer: string): Promise<Grade> => parseGrade((await ask(JUDGE_PROMPT(question, answer), WORK_MODEL, 0.5)).answer)?.grade ?? "unparsed";
    const grades: Record<string, Grade> = {};
    for (const m of MEASURED_MODELS) grades[m] = await grade((await ask(prompt, m, 0.5)).answer);
    const withRun = await runAgent(prompt, { condition: "none", model: "claude-opus-5-5", maxTurns: 2, maxBudgetUsd: 0.5, appendSystemPrompt: lessonContext(claim) });
    const withLesson = await grade(withRun.answer);
    out.push({ id: k.id, entry: k.entry, question, grades, with_lesson_opus: withLesson, with_lesson_answer: withRun.answer, loss: isLoss(grades["claude-opus-5-5"]!, withLesson) });
    write(dir, "bench.json", out);
  });
  const losses = (out as { id: string; loss: boolean }[]).filter((b) => b.loss);
  console.log(`bench: ${out.length} lessons measured; harm-check losses to read: ${losses.map((l) => l.id).join(", ") || "none"}.`);
}

/** How the machine checks judge a draft, so the agent that fixes one knows what will pass (packages/core, lessonProblems). */
export const CHECK_RULES = `How the checks work (they are the ones CI runs; a lesson can't pass until each problem is gone):
- "doesn't name <symbol>": the whole symbol field, as one string (case, quotes, and backticks aside), must appear inside every quote. Quote another sentence from a file in sources/ that contains it, or make symbol shorter so the quote contains it, as long as symbol still names what the change is about.
- "No evidence names <symbol>": the whole symbol must appear in a test's code or in a quote.
- "The detail uses words no source quote contains": each listed word must come from a quote, or from package, versions, symbol, or replacement; test code doesn't count. Reword the detail with the quotes' own words, or leave the detail out.
- "source: ...": the quote must be copied exactly from its file in sources/, with the url sources/sources.json gives for that file.
- "schema: ...": fix the field the message names. evidence holds 1 to 3 pieces: the differential test pair and one quote.`;

/**
 * A revise round (docs/decisions.md, "Revising seed drafts"). Scope `check`: each lesson that failed the local checks
 * goes back to the drafting model with those problems only. Scope `findings`: each lesson with review findings goes back
 * once, to the content model if a finding is under rule 1, 7, or 8 and to the drafting model otherwise; local-check
 * problems go with them. Lessons with nothing to fix, and lessons already kept for a PR, carry over unchanged. Writes
 * drafts-r<round>/; then run check and review with the same --round.
 */
export async function revise(dir: string, round: number, o: { scope?: string; model?: string; contentModel?: string } = {}): Promise<void> {
  if (round < 1) throw new Error("revise needs --round 1 or more.");
  const scope = o.scope ?? "findings";
  if (scope !== "check" && scope !== "findings") throw new Error("--scope is check or findings.");
  const prev = sfx(round - 1);
  const run = read<RunInfo>(dir, "run.json");
  const entries = new Map(read<Entry[]>(dir, "entries.json").map((e) => [e.id, e]));
  const tags = new Map(read<{ version: string; tag: string }[]>(dir, "releases.json").map((r) => [r.version, r.tag]));
  const checks = read<CheckRecord[]>(dir, `check${prev}.json`);
  const reviews = new Map(read<{ entry: string; findings: Finding[]; error?: string }[]>(dir, `review${prev}.json`).map((r) => [r.entry, r]));
  const kept = keptEntries(dir);
  const outDir = join(dir, `drafts${sfx(round)}`);
  mkdirSync(outDir, { recursive: true });
  const doc = await registryDoc(run.package);
  const done: Record<string, { lessons: number; cost: number }> = {};
  await pool(checks, 3, async (c) => {
    if (existsSync(join(outDir, `${safeName(c.entry)}.json`))) return;
    const old = read<DraftRecord>(join(dir, `drafts${prev}`), `${safeName(c.entry)}.json`);
    const reviewed = reviews.get(c.entry)?.findings ?? [];
    const route = kept.has(c.entry) ? "carry" : reviseRoute(c.problems, reviewed, scope);
    if (route === "carry") {
      write(outDir, `${safeName(c.entry)}.json`, old);
      return;
    }
    const model = route === "content" ? (o.contentModel ?? CONTENT_MODEL) : (o.model ?? WORK_MODEL);
    const findings = [...c.problems.map((problem) => ({ rule: "check", problem })), ...(scope === "findings" ? reviewed : [])];
    const entry = entries.get(c.entry)!;
    const record: DraftRecord = { entry: c.entry, verdict: old.verdict, cost_usd: 0, turns: 0, round, model };
    try {
      const prepared = await prepare({ run, entry, verdict: old.verdict, tag: tags.get(entry.version)!, all: Object.keys(doc.versions), directory: doc.repository?.directory, cache: CACHE, repoRoot: REPO_ROOT, gh, fetchText });
      writeFileSync(join(prepared.folder, "draft.json"), JSON.stringify(old.draft, null, 2));
      writeFileSync(join(prepared.folder, "REVIEW.md"), ["# These problems were found in draft.json (rule \"check\": the machine checks CI also runs; numbers: the reviewer's checklist)", "", ...findings.map((f) => `- (rule ${f.rule}) ${f.problem}`)].join("\n"));
      let work = "";
      const task =
        scope === "check"
          ? `draft.json already holds your earlier draft, and REVIEW.md lists what the machine checks found wrong with it. Fix each problem and overwrite draft.json. Change only what a fix needs and keep the rest as it is. If the lesson can't pass these checks and stay true, replace it with {"skip": "<why>"}.\n\n${CHECK_RULES}`
          : `draft.json already holds your earlier draft, and REVIEW.md lists what a reviewer (and, under rule "check", the machine checks) found wrong with it. Fix every finding you agree with and overwrite draft.json; if the change can't be taught truthfully in one lesson, replace it with {"skip": "<why>"}. If a finding asks to split a loud part from a silent part, keep the silent one. Your fix must still pass the machine checks.\n\n${CHECK_RULES}`;
      const r = await agentIn(prepared.folder, `${draftPrompt(run.package, prepared)}\n\n${task}`, model, { prepare: (w) => (work = w) });
      record.cost_usd = r.costUsd;
      record.turns = r.turns;
      const json = JSON.parse(readFileSync(join(work, "draft.json"), "utf8")) as Record<string, unknown>;
      if (typeof json.skip === "string") record.skip = json.skip;
      else record.draft = json;
    } catch (err) {
      record.error = (err as Error).message;
    }
    const d = (done[model] ??= { lessons: 0, cost: 0 });
    d.lessons++;
    d.cost += record.cost_usd;
    write(outDir, `${safeName(c.entry)}.json`, record);
    console.log(`revise ${c.entry} (${model}): ${record.draft ? "revised" : record.skip ? `skipped (${record.skip})` : `error (${record.error})`}`);
  });
  const by = Object.entries(done).map(([m, d]) => `${d.lessons} by ${m} ($${d.cost.toFixed(2)})`).join(", ");
  console.log(`revise (round ${round}, scope ${scope}): ${by || "nothing to revise"}; run check and review with --round ${round}.`);
}
