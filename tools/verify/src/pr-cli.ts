#!/usr/bin/env node
// npm run verify:pr -- [--json <path>]
// Run by verify.yml on every pull request. Reads the PR from $GITHUB_EVENT_PATH.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { validateLesson, type Lesson } from "@ludion/core";
import { compileLessonSchema } from "./base-schema.ts";
import { pullImages, runInDocker } from "./docker.ts";
import { parseNameStatus, planChanges, verifyPullRequest, type PullRequestAuthor } from "./pr.ts";
import { countByStatus, labelsOf, printResults, stepSummary } from "./report.ts";
import { createSafeFetch } from "./safe-fetch.ts";
import { runtimesIn } from "./files.ts";
import { lockfileSha256AtHead, verifierProvenance, verifierRootFromModule } from "./verifier-deps.ts";
import type { LessonFile } from "./verify.ts";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** main's lessons in either format (format 0 files stay valid), for the replaces check. */
function baseLessons(baseRef: string): Lesson[] {
  const paths = git("ls-tree", "-r", "--name-only", baseRef, "--", "lessons/").split("\n").filter((p) => /^lessons\/[^/]+\/[^/]+\.json$/.test(p));
  const lessons: Lesson[] = [];
  for (const p of paths) {
    try {
      const v = validateLesson(JSON.parse(git("show", `${baseRef}:${p}`)));
      if (v.ok) lessons.push(v.lesson);
    } catch {
      // A broken file on the base branch is not this PR's problem.
    }
  }
  return lessons;
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { json: { type: "string", default: "results.json" } } });
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error("GITHUB_EVENT_PATH is not set. verify:pr runs in GitHub Actions; locally, use npm run verify -- <files>.");
    return 2;
  }
  const pr = JSON.parse(readFileSync(eventPath, "utf8")).pull_request;
  if (!pr) {
    console.error("This event has no pull_request. Run verify:pr only on pull_request events.");
    return 2;
  }
  const baseRef = `origin/${pr.base.ref}`;
  const author: PullRequestAuthor = { id: pr.user.id, login: pr.user.login, type: pr.user.type };
  // The schema comes from the base branch, never from the PR: a PR cannot loosen what it is checked against.
  const validate = compileLessonSchema(git("show", `${baseRef}:lessons/lessons.schema.json`));

  // Every file the PR changes, not only lessons/: a lesson PR may change nothing else.
  const plan = planChanges(parseNameStatus(git("diff", "--no-renames", "--name-status", `${baseRef}...HEAD`)));
  const added: LessonFile[] = plan.added.map((path) => ({ path, text: readFileSync(path, "utf8") }));

  const pullFailures = pullImages(runtimesIn(added, validate));
  for (const f of pullFailures) console.error(f);

  const results = await verifyPullRequest(plan, added, {
    base: baseLessons(baseRef),
    fetchFn: createSafeFetch(),
    run: runInDocker,
    validate,
    author,
  });

  printResults(results);
  const labels = labelsOf(results);
  // Provenance is for the P1 Capability runner. results and labels are unchanged.
  // The expected lockfile hash is the git blob at HEAD, not the working tree.
  const verifierRoot = verifierRootFromModule(import.meta.url);
  let expectedLockfileSha256: string | undefined;
  let lockfileError: "lockfile_git_blob_unreadable" | undefined;
  try {
    expectedLockfileSha256 = lockfileSha256AtHead(verifierRoot);
  } catch {
    lockfileError = "lockfile_git_blob_unreadable";
  }
  const verifier = verifierProvenance({
    verifierRoot,
    recipientRoot: process.cwd(),
    nodeVersion: process.version,
    expectedLockfileSha256,
    lockfileError,
  });
  writeFileSync(values.json, JSON.stringify({ results, labels, verifier }, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary(results));
  return countByStatus(results).failed > 0 ? 1 : 0;
}

process.exitCode = await main();
