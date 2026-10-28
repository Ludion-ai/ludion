// Runs the judge on a PR's dependency files and records the result for judge-comment.yml (.github/workflows/judge.yml).
// The judge is the base commit's build; the PR's package.json and package-lock.json are only read as data. The record
// is undecidable unless the judge finished with a judgement: a failure is never recorded as a pass.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderJudgement, type Judgement } from "../../packages/cli/src/security/judge.ts";

const VERDICTS: Judgement["verdict"][] = ["stop", "wait", "ready_except_build", "undecidable"];
/** The judge's exit code for each verdict (packages/cli/src/security/judge-cli.ts); 2 means it could not read the inputs. */
const EXIT: Record<Judgement["verdict"], number> = { ready_except_build: 0, wait: 3, stop: 1, undecidable: 1 };
/** judge-comment.yml accepts at most this much text, counted as shown (GitHub's comment limit is 65,536 characters). */
export const TEXT_LIMIT = 60_000;
export const REASON_LIMIT = 2_000;

/** A text's size once judge-comment.yml shows it as a code block, four spaces before each line. */
export const shownSize = (text: string) => text.length + 4 * text.split("\n").length;
/** Cuts a text at a line, where it can, so that it is at most `limit` as shown, and ends it with `note`. */
export function fit(text: string, limit: number, note: string): string {
  if (shownSize(text) <= limit) return text;
  let budget = limit - shownSize(note);
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    // Each kept line costs its length, its newline and its four spaces.
    if (line.length + 5 > budget) { if (budget > 5) kept.push(line.slice(0, budget - 5)); break; }
    kept.push(line);
    budget -= line.length + 5;
  }
  return [...kept, note].join("\n");
}

/** The judge's --files value. A name with a comma or surrounding spaces would not survive its comma-separated list. */
export function filesArgument(files: string[]): string {
  const odd = files.filter(f => f.includes(",") || f !== f.trim());
  if (odd.length) throw new Error(`Changed file names that the judge's --files list cannot carry: ${odd.slice(0, 5).map(f => JSON.stringify(f)).join(", ")}.`);
  return files.join(",");
}

export type Meta = { pr: number; head_sha: string; base_sha: string; merge_sha: string; started_at: string };
export type Run = { exitCode: number | null; stdout: string; stderr: string; error?: string; seconds: number };
export type JudgeRecord = Meta & {
  schema: 1;
  verdict: Judgement["verdict"];
  /** Why there is no judgement (the judge failed or did not run); null when there is one. */
  reason: string | null;
  finished_at: string;
  /** The judge's own run time, and the time since the job started (install and build included). */
  judge_seconds: number | null;
  job_seconds: number;
  judge_exit_code: number | null;
  judgement: Judgement | null;
  /** The judgement as the judge renders it, for the comment. */
  text: string | null;
};

/** The record of one judge run, or of one that never started (the second argument is then the reason). */
export function recordOf(meta: Meta, run: Run | string, now = new Date()): JudgeRecord {
  const job_seconds = Math.max(0, now.getTime() - Date.parse(meta.started_at)) / 1000;
  const undecidable = (reason: string): JudgeRecord => ({
    schema: 1, ...meta, verdict: "undecidable", reason: fit(reason, REASON_LIMIT, "… (cut here; see the run log)"), finished_at: now.toISOString(),
    judge_seconds: typeof run === "string" ? null : run.seconds, job_seconds, judge_exit_code: typeof run === "string" ? null : run.exitCode, judgement: null, text: null,
  });
  if (typeof run === "string") return undecidable(run);
  if (run.error) return undecidable(`The judge did not finish: ${run.error}`);
  let judgement: Judgement;
  try { judgement = JSON.parse(run.stdout); } catch { return undecidable(`The judge exited ${run.exitCode} without a judgement: ${run.stderr.trim().slice(-1500) || "no output"}`); }
  if (!judgement || typeof judgement !== "object" || judgement.schema !== 1 || !VERDICTS.includes(judgement.verdict)) return undecidable(`The judge exited ${run.exitCode} with output that is not a judgement.`);
  if (run.exitCode !== EXIT[judgement.verdict]) return undecidable(`The judge exited ${run.exitCode}, which does not match its verdict "${judgement.verdict}".`);
  let text: string;
  try { text = renderJudgement(judgement); } catch (error) { return undecidable(`The judgement could not be rendered: ${error instanceof Error ? error.message : String(error)}`); }
  text = fit(text, TEXT_LIMIT, "… (cut here; the full judgement is in the run's judgement artifact)");
  return { schema: 1, ...meta, verdict: judgement.verdict, reason: null, finished_at: now.toISOString(), judge_seconds: run.seconds, job_seconds, judge_exit_code: run.exitCode, judgement, text };
}

function meta(env: NodeJS.ProcessEnv): Meta {
  const sha = (name: string) => { const v = env[name] ?? ""; if (!/^[0-9a-f]{40}$/.test(v)) throw new Error(`${name} is not a commit SHA.`); return v; };
  const pr = Number(env.PR);
  if (!Number.isInteger(pr) || pr < 1) throw new Error("PR is not a pull request number.");
  if (!Number.isFinite(Date.parse(env.STARTED_AT ?? ""))) throw new Error("STARTED_AT is not a time.");
  return { pr, head_sha: sha("HEAD_SHA"), base_sha: sha("BASE_SHA"), merge_sha: sha("MERGE_SHA"), started_at: env.STARTED_AT! };
}

/** Runs the base commit's build of the judge on the files the read step wrote. */
function judged(m: Meta, input: string): JudgeRecord {
  let files: string;
  try { files = filesArgument(readFileSync(join(input, "files"), "utf8").split("\0").filter(Boolean)); } catch (error) { return recordOf(m, error instanceof Error ? error.message : String(error)); }
  const start = performance.now();
  const r = spawnSync(process.execPath, ["packages/cli/dist/cli.js", "judge", "--before", join(input, "before"), "--after", join(input, "after"), "--files", files, "--json"], { encoding: "utf8", timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const seconds = Math.round(performance.now() - start) / 1000;
  return recordOf(m, { exitCode: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", error: r.error?.message ?? (r.signal ? `stopped by ${r.signal}` : undefined), seconds });
}

/** Exit 0 when the judge gave a judgement (any verdict), 1 when it did not: the job's colour shows the judge's health. */
function main(env: NodeJS.ProcessEnv): number {
  const m = meta(env), out = env.RECORD ?? "";
  // The read step runs first: it finds the base commit that the build step then builds.
  const record = env.READ_OUTCOME !== "success" ? recordOf(m, "The PR's package.json and package-lock.json could not be read; see the run log.")
    : env.BUILD_OUTCOME !== "success" ? recordOf(m, "The judge could not be built from the base commit; see the run log.")
    : judged(m, env.INPUT ?? "");
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  const { judgement: _, text, ...summary } = record;
  console.log(JSON.stringify(summary, null, 2));
  if (text) console.log(text);
  return record.judgement ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.env);
