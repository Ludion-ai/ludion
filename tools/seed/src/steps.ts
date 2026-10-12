// The pipeline's later steps: draft, check, review, lessons, summary (see cli.ts for the commands).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  activeSet, checkSource, formatLesson, generateClaim, isV1, lessonProblems, newId, subjectFor, validateLesson, validateLessonV1, verifiedBy,
  type Lesson, type LessonV1,
} from "@ludion/core";
import semver from "semver";
import { createSafeFetch } from "../../verify/src/safe-fetch.ts";
import type { Entry } from "./collect.ts";
import { draftPrompt, prepare } from "./draft.ts";
import { read, write, type RunInfo } from "./io.ts";
import { agentIn, ask, extractJson, pool, WORK_MODEL } from "./llm.ts";
import { reviewPrompt, parseFindings, type Finding } from "./review.ts";
import { draftOrder, KINDS, type Kind, type Verdict } from "./triage.ts";

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");
/** Package copies and agent folders live outside the repo: they are large and rebuilt on demand. */
export const CACHE = process.env.LUDION_SEED_CACHE || resolve(REPO_ROOT, "..", "ludion-seedwork");
export const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** The account that opens seed PRs signs them (CLAUDE.md, "Attribution is identity"). */
export const SEED_AUTHOR = { login: "Ludion-ai", id: 292738933 };

export interface DraftRecord {
  entry: string;
  verdict: Verdict;
  /** The agent's draft, or why it skipped. */
  draft?: Record<string, unknown>;
  skip?: string;
  error?: string;
  cost_usd: number;
  turns: number;
}

export const safeName = (id: string) => id.replace("#", "-");

export async function registryDoc(pkg: string): Promise<{ versions: Record<string, unknown>; repository?: { directory?: string } }> {
  const res = await fetch(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`);
  if (!res.ok) throw new Error(`npm registry answered ${res.status} for ${pkg}.`);
  return (await res.json()) as never;
}

export async function fetchText(url: string): Promise<string | undefined> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return res.ok ? res.text() : undefined;
}

async function draft(dir: string, o: { model?: string; kinds?: string; limit?: string; signal?: string; versions?: string }) {
  const run = read<RunInfo>(dir, "run.json");
  const entries = new Map(read<Entry[]>(dir, "entries.json").map((e) => [e.id, e]));
  const releases = new Map(read<{ version: string; tag: string }[]>(dir, "releases.json").map((r) => [r.version, r.tag]));
  const kinds = (o.kinds?.split(",") ?? KINDS) as Kind[];
  mkdirSync(join(dir, "drafts"), { recursive: true });
  const done = new Set(readdirSync(join(dir, "drafts")).map((f) => f.replace(/\.json$/, "")));
  const todo = read<Verdict[]>(dir, "triage.json")
    .filter((v) => v.candidate && kinds.includes(v.kind!) && (!o.signal || v.signal === o.signal) && (!o.versions || semver.satisfies(v.id.split("#")[0]!, o.versions)) && !done.has(safeName(v.id)))
    .sort(draftOrder)
    .slice(0, o.limit ? Number(o.limit) : undefined);
  const doc = await registryDoc(run.package);
  const all = Object.keys(doc.versions);
  const model = o.model ?? WORK_MODEL;
  console.log(`draft: ${todo.length} candidates with ${model}.`);
  let cost = 0;
  await pool(todo, 3, async (verdict) => {
    const entry = entries.get(verdict.id)!;
    const record: DraftRecord = { entry: entry.id, verdict, cost_usd: 0, turns: 0 };
    try {
      const prepared = await prepare({ run, entry, verdict, tag: releases.get(entry.version)!, all, directory: doc.repository?.directory, cache: CACHE, repoRoot: REPO_ROOT, gh, fetchText });
      let work = "";
      const r = await agentIn(prepared.folder, draftPrompt(run.package, prepared), model, { prepare: (w) => (work = w) });
      record.cost_usd = r.costUsd;
      record.turns = r.turns;
      cost += r.costUsd;
      const out = join(work, "draft.json");
      if (!existsSync(out)) throw new Error(`no draft.json (${r.isError ? "run ended with an error" : r.answer.slice(0, 200)})`);
      const json = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
      if (typeof json.skip === "string") record.skip = json.skip;
      else record.draft = json;
    } catch (err) {
      record.error = (err as Error).message;
    }
    write(join(dir, "drafts"), `${safeName(entry.id)}.json`, record);
    console.log(`draft ${entry.id}: ${record.draft ? "drafted" : record.skip ? `skipped (${record.skip})` : `error (${record.error})`}`);
  });
  console.log(`draft: done, $${cost.toFixed(2)}.`);
}

/** File-name suffix for a review round: round 0 is the first draft, round N the drafts revised N times. */
export const sfx = (round = 0) => (round ? `-r${round}` : "");

export function drafts(dir: string, round = 0): DraftRecord[] {
  const d = join(dir, `drafts${sfx(round)}`);
  return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort().map((f) => read<DraftRecord>(d, f)) : [];
}

/** A draft as the lesson it would become: id, subject, author, and time are set here, never by the draft. */
export function toSeedLesson(d: Record<string, unknown>, now: Date, id = newId(now.getTime())): LessonV1 {
  const { id: _i, author: _a, author_id: _ai, created_at: _c, format: _f, subject: _s, ...fields } = d;
  const lesson = {
    format: 1,
    id,
    subject: subjectFor(fields.package as LessonV1["package"]),
    ...fields,
    author: `github:${SEED_AUTHOR.login}`,
    author_id: SEED_AUTHOR.id,
    drafted_by: "agent",
    created_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
  return JSON.parse(formatLesson(lesson as LessonV1)) as LessonV1;
}

export interface CheckRecord {
  entry: string;
  lesson?: LessonV1;
  problems: string[];
  label?: string;
  claim?: string;
}

/** Every check this machine can run without Docker: schema, lessonProblems, sources, and the label tests would earn. */
async function check(dir: string, round = 0) {
  const fetchFn = createSafeFetch();
  const out: CheckRecord[] = [];
  let t = Date.now();
  for (const rec of drafts(dir, round).filter((r) => r.draft)) {
    const lesson = toSeedLesson(rec.draft!, new Date(t++));
    const problems: string[] = [];
    const v = validateLessonV1(lesson);
    if (!v.ok) problems.push(...v.errors.map((e) => `schema: ${e.path} ${e.message}`));
    else {
      problems.push(...lessonProblems(lesson));
      for (const e of lesson.evidence) {
        if (!("source" in e)) continue;
        const r = await checkSource(e.source.url, e.source.quote, fetchFn);
        if (!r.found) problems.push(`source: ${r.reason ?? "quote not found"} (${e.source.url})`);
      }
    }
    out.push({ entry: rec.entry, lesson, problems, label: v.ok ? verifiedBy(lesson) : undefined, claim: v.ok ? generateClaim(lesson) : undefined });
  }
  write(dir, `check${sfx(round)}.json`, out);
  const ok = out.filter((c) => c.problems.length === 0);
  console.log(`check: ${out.length} drafts, ${ok.length} pass every local check (${ok.filter((c) => c.label === "differential").length} differential). Docker tests run in CI.`);
}

/** A fresh-context reviewer reads every lesson that passed the local checks, with the review checklist. */
async function review(dir: string, model: string, round = 0) {
  const run = read<RunInfo>(dir, "run.json");
  const entries = new Map(read<Entry[]>(dir, "entries.json").map((e) => [e.id, e]));
  const checked = read<CheckRecord[]>(dir, `check${sfx(round)}.json`).filter((c) => c.problems.length === 0);
  const results = await pool(checked, 4, async (c) => {
    const r = await ask(reviewPrompt(run.package, c.lesson!, c.claim!, entries.get(c.entry)!.text), model, 3);
    return { entry: c.entry, findings: parseFindings(extractJson(r.answer)), cost_usd: r.costUsd };
  });
  const out = results.map((r, i) => (r instanceof Error ? { entry: checked[i]!.entry, error: r.message, findings: [] as Finding[] } : r));
  write(dir, `review${sfx(round)}.json`, out);
  const n = out.reduce((s, r) => s + r.findings.length, 0);
  console.log(`review: ${out.length} lessons, ${n} findings, ${out.filter((r) => r.findings.length === 0 && !("error" in r)).length} with none.`);
}

/** Write the lessons that passed the local checks and have no review finding, as files for a PR. */
/** Active lessons on main (in this checkout) as [id, versions, symbol], for the duplicate check. */
function mainLessons(): { id: string; versions: string; symbol: string }[] {
  const root = join(REPO_ROOT, "lessons");
  const all: Lesson[] = [];
  for (const s of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(root, s.name)).filter((f) => f.endsWith(".json"))) {
      const v = validateLesson(JSON.parse(readFileSync(join(root, s.name, f), "utf8")));
      if (v.ok) all.push(v.lesson);
    }
  }
  return activeSet(all).filter(isV1).map((l) => ({ id: l.id, versions: l.versions, symbol: l.symbol }));
}

/** Another lesson teaches the same change when it has the same versions and the symbols are equal or one holds the other. */
export function isDuplicate(l: { versions: string; symbol: string }, others: { id: string; versions: string; symbol: string }[]): string | undefined {
  const norm = (x: string) => x.toLowerCase();
  return others.find((o) => o.versions === l.versions && (norm(o.symbol).includes(norm(l.symbol)) || norm(l.symbol).includes(norm(o.symbol))))?.id;
}

/**
 * Write the lessons that passed the local checks and have no review finding, as files for a PR. A lesson that repeats
 * one already on main (same versions, same or overlapping symbol) is not written and is listed as a duplicate: it shows
 * what the pipeline recovers of the hand-made seeds.
 */
function lessons(dir: string, outDir: string, round = 0) {
  const review = new Map(read<{ entry: string; findings: Finding[]; error?: string }[]>(dir, `review${sfx(round)}.json`).map((r) => [r.entry, r]));
  const clean = read<CheckRecord[]>(dir, `check${sfx(round)}.json`).filter((c) => c.problems.length === 0 && review.get(c.entry) && !review.get(c.entry)!.error && review.get(c.entry)!.findings.length === 0);
  const main = mainLessons();
  const duplicates = clean.map((c) => ({ c, of: isDuplicate(c.lesson as LessonV1, main) })).filter((x) => x.of);
  const keep = clean.filter((c) => !duplicates.some((d) => d.c === c));
  for (const c of keep) {
    const folder = join(outDir, c.lesson!.subject);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, `${c.lesson!.id}.json`), formatLesson(c.lesson!));
  }
  write(dir, "kept.json", keep.map((c) => ({ entry: c.entry, id: c.lesson!.id, claim: c.claim, label: c.label })));
  write(dir, "duplicates.json", duplicates.map((d) => ({ entry: d.c.entry, of: d.of, claim: d.c.claim })));
  console.log(`lessons: wrote ${keep.length} to ${outDir}; ${duplicates.length} repeat a lesson on main.`);
}

/** The counts this run measured, for docs/bench. */
function summary(dir: string) {
  const run = read<RunInfo>(dir, "run.json");
  const entries = read<Entry[]>(dir, "entries.json");
  const triage = existsSync(join(dir, "triage.json")) ? read<Verdict[]>(dir, "triage.json") : [];
  const ds = drafts(dir);
  // One row per review round that ran: round 0 is the first draft.
  const rounds: Record<string, number>[] = [];
  for (let r = 0; existsSync(join(dir, `review${sfx(r)}.json`)); r++) {
    const checks = read<CheckRecord[]>(dir, `check${sfx(r)}.json`);
    const reviews = read<{ findings: Finding[]; error?: string }[]>(dir, `review${sfx(r)}.json`);
    rounds.push({
      round: r,
      drafts: checks.length,
      local_checks_passed: checks.filter((c) => c.problems.length === 0).length,
      differential: checks.filter((c) => c.problems.length === 0 && c.label === "differential").length,
      review_findings: reviews.reduce((a, x) => a + x.findings.length, 0),
      reviewed_clean: reviews.filter((x) => !x.error && x.findings.length === 0).length,
    });
  }
  const ci = existsSync(join(dir, "ci.json")) ? read<{ rounds: { status: string }[][] }>(dir, "ci.json").rounds : [];
  const kept = existsSync(join(dir, "kept.json")) ? read<unknown[]>(dir, "kept.json") : [];
  const byKind = Object.fromEntries(KINDS.map((k) => [k, triage.filter((v) => v.candidate && v.kind === k).length]));
  const skips: Record<string, number> = {};
  for (const v of triage.filter((t) => !t.candidate)) skips[v.skip!] = (skips[v.skip!] ?? 0) + 1;
  const s = {
    package: run.package,
    range: run.range,
    versions: run.versions.length,
    entries: entries.length,
    triaged: triage.length,
    candidates: triage.filter((v) => v.candidate).length,
    candidates_by_kind: byKind,
    candidates_silent: triage.filter((v) => v.candidate && v.signal === "silent").length,
    skipped_by_reason: skips,
    drafted: ds.filter((d) => d.draft).length,
    draft_skipped: ds.filter((d) => d.skip).length,
    draft_errors: ds.filter((d) => d.error).length,
    draft_cost_usd: Number(ds.reduce((a, d) => a + d.cost_usd, 0).toFixed(2)),
    rounds,
    kept: kept.length,
    duplicates_of_main: existsSync(join(dir, "duplicates.json")) ? read<unknown[]>(dir, "duplicates.json").length : 0,
    ci: ci.map((r) => ({ lessons: r.length, passed: r.filter((x) => x.status === "passed").length })),
  };
  write(dir, "summary.json", s);
  console.log(JSON.stringify(s, null, 2));
}

export async function run(step: string, dir: string, o: Record<string, string | undefined>) {
  if (step === "draft") return draft(dir, o);
  const round = Number(o.round ?? 0);
  if (step === "check") return check(dir, round);
  if (step === "review") return review(dir, o.model ?? WORK_MODEL, round);
  if (step === "lessons") {
    if (!o.out) throw new Error("lessons needs --out <folder>.");
    return lessons(dir, o.out, round);
  }
  if (step === "summary") return summary(dir);
  const later = await import("./ci.ts");
  if (step === "ci") {
    if (!o.pr) throw new Error("ci needs --pr <number>.");
    return later.ci(dir, o.pr);
  }
  if (step === "revise") return later.revise(dir, round, o.model);
  if (step === "fix" || step === "bench") {
    if (!o.out) throw new Error(`${step} needs --out <the PR branch's lessons folder>.`);
    return step === "fix" ? later.fix(dir, o.out, o.model) : later.bench(dir, o.out);
  }
  throw new Error(`Unknown step ${step}.`);
}
