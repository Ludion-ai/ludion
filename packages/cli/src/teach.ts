// ludion teach: turn a draft into a lesson, check it on this machine, and save it to the personal ledger.
// Tests run only in Docker with the network off, and only when Docker is installed (CLAUDE.md).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  checkSource, formatLesson, generateClaim, lessonProblems, newId, subjectFor, validateLessonV1,
  type FetchFn, type LessonV1,
} from "@ludion/core";
import { interpretRun, runInDocker, type RunFn } from "../../../tools/verify/src/docker.ts";
import { createSafeFetch } from "../../../tools/verify/src/safe-fetch.ts";
import type { LedgerEntry } from "./ledger.ts";

export type Draft = Omit<LessonV1, "format" | "id" | "author" | "author_id" | "created_at" | "subject"> & { subject?: string; format?: 1 };

export interface Identity {
  login: string;
  id: number;
}

/** A draft from --draft <base64url JSON>, a file, or "-" for stdin. */
export function readDraft(arg: string): Draft {
  let text: string;
  if (arg === "-") text = readFileSync(0, "utf8");
  else if (existsSync(arg)) text = readFileSync(arg, "utf8");
  else if (/^[A-Za-z0-9_-]+$/.test(arg)) text = Buffer.from(arg, "base64url").toString("utf8");
  else throw new Error(`No file ${arg}. Pass a draft file, - for stdin, or the --draft value ludion_teach gave you.`);
  try {
    return JSON.parse(text) as Draft;
  } catch {
    throw new Error("The draft is not valid JSON. Pass a file, - for stdin, or the --draft value ludion_teach gave you.");
  }
}

/** The teacher's GitHub account from their own gh, or undefined when gh is missing or signed out. */
export function ghIdentity(): Identity | undefined {
  const r = spawnSync("gh", ["api", "user", "--jq", "[.login, .id] | @tsv"], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  const [login, id] = r.stdout.trim().split("\t");
  return login && Number(id) > 0 ? { login, id: Number(id) } : undefined;
}

/** The lesson the draft becomes. Without a GitHub account yet, the author fields are placeholders until --public. */
export function toLesson(draft: Draft, who: Identity | undefined, now: Date, id = newId(now.getTime())): LessonV1 {
  const { format: _f, subject, ...fields } = draft;
  return {
    format: 1,
    id,
    subject: subject ?? subjectFor(draft.package),
    ...fields,
    author: `github:${who?.login ?? "you"}`,
    author_id: who?.id ?? 1,
    created_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  } as LessonV1;
}

export interface CheckReport {
  problems: string[];
  tests: string;
  sources: string;
}

export function dockerAvailable(): boolean {
  return spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" }).status === 0;
}

/** Every check this machine can run. Problems block teaching; tests that can't run here are reported, not failed. */
export async function check(lesson: LessonV1, opts: { fetchFn?: FetchFn; run?: RunFn; docker?: boolean } = {}): Promise<CheckReport> {
  const problems: string[] = [];
  const v = validateLessonV1(JSON.parse(formatLesson(lesson)));
  if (!v.ok) return { problems: v.errors.map((e) => `${e.path}: ${e.message}`), tests: "not run", sources: "not checked" };
  problems.push(...lessonProblems(lesson));

  const sources = lesson.evidence.flatMap((e) => ("source" in e ? [e.source] : []));
  const fetchFn = opts.fetchFn ?? createSafeFetch();
  let sourcesState = sources.length ? "found" : "none";
  for (const s of sources) {
    const r = await checkSource(s.url, s.quote, fetchFn);
    if (!r.found) {
      problems.push(`Source ${s.url}: ${r.reason}`);
      sourcesState = "not found";
    }
  }

  const tests = lesson.evidence.flatMap((e) => ("test" in e ? [e.test] : []));
  let testsState = tests.length ? "passed" : "none";
  if (tests.length && !(opts.docker ?? dockerAvailable())) testsState = "not run (Docker isn't installed here; CI runs them)";
  else {
    for (const t of tests) {
      const r = interpretRun(await (opts.run ?? runInDocker)({ runtime: t.runtime, code: t.code, packages: t.packages }), t.expect ?? "pass", t.error);
      if (r.status !== "passed") {
        problems.push(`Test (${t.runtime}): ${r.status === "skipped" ? r.reason : r.reason}`);
        testsState = "failed";
      }
    }
  }
  return { problems, tests: testsState, sources: sourcesState };
}

/** The whole lesson as the teacher should see it before signing. */
export function showLesson(lesson: LessonV1): string {
  const lines = [generateClaim(lesson), ""];
  for (const e of lesson.evidence) {
    if ("source" in e) lines.push(`Source: ${e.source.url}`, `  "${e.source.quote}"`);
    else {
      const pins = Object.entries(e.test.packages ?? {}).map(([n, v]) => `${n}@${v}`).join(", ");
      lines.push(`Test on ${e.test.runtime}${pins ? ` with ${pins}` : ""}${e.test.expect === "fail" ? `, expected to fail with "${e.test.error}"` : ""}:`);
      lines.push(...e.test.code.split("\n").map((l) => `  ${l}`));
    }
    lines.push("");
  }
  lines.push(`Signal: ${lesson.signal}. File: lessons/${lesson.subject}/${lesson.id}.json`);
  return lines.join("\n");
}

export function ledgerEntry(lesson: LessonV1, report: CheckReport, now: Date): LedgerEntry {
  return { lesson, taught_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"), checks: { tests: report.tests, sources: report.sources } };
}
