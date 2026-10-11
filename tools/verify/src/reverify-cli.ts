#!/usr/bin/env node
// The report side of nightly reverify. It reads verify's results and its own failing.json; it never runs lesson code.
//   node tools/verify/src/reverify-cli.ts count <tonight results.json> [<last night results.json>] --out failing.json [--last-failing <failing.json>]
//   node tools/verify/src/reverify-cli.ts report <failing.json>
// count decides what fails tonight and never fails the run, so failing.json is always uploaded. report prepares a
// retraction branch and an issue per failing lesson (needs gh and a token that can push and open issues); it exits 1
// when tonight was suspended (too many failures at once) or a lesson couldn't be reported.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, retractionIssue, safeFailing, type Failing, type FailingFile } from "./reverify.ts";
import type { LessonResult } from "./verify.ts";

const USAGE = "Usage: node tools/verify/src/reverify-cli.ts count <tonight results.json> [<last night results.json>] --out failing.json | report <failing.json>";

const results = (path: string | undefined): LessonResult[] | undefined =>
  path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { results: LessonResult[] }).results : undefined;

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function count(args: string[]): number {
  const out = args[args.indexOf("--out") + 1];
  const lastFailingPath = args.includes("--last-failing") ? args[args.indexOf("--last-failing") + 1] : undefined;
  const [tonightPath, lastPath] = args.filter((a, i) => !a.startsWith("--") && !["--out", "--last-failing"].includes(args[i - 1]!));
  const tonight = results(tonightPath);
  if (!tonight || !out || !args.includes("--out")) {
    console.error(USAGE);
    return 2;
  }
  const lastFailing = lastFailingPath && existsSync(lastFailingPath) ? ((JSON.parse(readFileSync(lastFailingPath, "utf8")) as Partial<FailingFile>).failing ?? []).map(safeFailing).filter((f): f is Failing => !!f) : [];
  const decision = decide(tonight, results(lastPath), new Date(), lastFailing);
  writeFileSync(out, JSON.stringify(decision, null, 2) + "\n");
  const failed = tonight.filter((r) => r.status === "failed").length;
  if (decision.suspended) console.log(`${decision.suspended.failed} of ${tonight.length} lessons count as failing tonight: that looks like the check, not the lessons. Last night's list stands (${decision.failing.length} withheld).`);
  else console.log(`${tonight.length} lessons checked; ${decision.failing.length} failing${failed > decision.failing.length ? `; ${failed - decision.failing.length} failed only on a source or an outage for the first night (counted if they fail again)` : ""}.`);
  return 0;
}

function reportOne(f: Failing, repo: string, runUrl: string): string {
  const { title, body } = retractionIssue(f, repo, runUrl);
  // Any issue for this lesson, open or closed: a closed one means a person decided, so it isn't reopened nightly.
  const seen = run("gh", ["issue", "list", "--repo", repo, "--state", "all", "--search", `${f.id} in:title`, "--json", "title", "--jq", `[.[] | select(.title == ${JSON.stringify(title)})] | length`]);
  if (seen !== "0") return `${f.id}: already reported`;
  run("git", ["fetch", "--quiet", "origin", "main"]);
  if (run("git", ["ls-tree", "--name-only", "origin/main", "--", f.file]) === "") return `${f.id}: no longer on main`;
  const branch = `retract/${f.id}`;
  run("git", ["switch", "--quiet", "-C", branch, "origin/main"]);
  run("git", ["rm", "--quiet", "--", f.file]);
  run("git", ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--quiet", "-m", `Retract ${f.id}: its evidence fails the nightly check`]);
  run("git", ["push", "--quiet", "--force", "origin", branch]);
  const bodyFile = join(mkdtempSync(join(tmpdir(), "reverify-")), "body.md");
  writeFileSync(bodyFile, body);
  return run("gh", ["issue", "create", "--repo", repo, "--title", title, "--body-file", bodyFile, "--label", "retract"]);
}

function report(path: string | undefined): number {
  if (!path) {
    console.error(USAGE);
    return 2;
  }
  const decision = JSON.parse(readFileSync(path, "utf8")) as Partial<FailingFile>;
  if (decision.suspended) {
    console.error(`Suspended: ${decision.suspended.failed} of ${decision.suspended.checked} lessons counted as failing at once. Last night's list stands and nothing new was reported; find out what broke the check.`);
    return 1;
  }
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  let errors = 0;
  for (const raw of decision.failing ?? []) {
    const f = safeFailing(raw);
    if (!f) {
      console.error(`Skipped an entry that isn't a lesson at its own path: ${JSON.stringify(raw).slice(0, 200)}`);
      errors++;
      continue;
    }
    try {
      console.log(reportOne(f, repo, runUrl));
    } catch (err) {
      console.error(`${f.id}: could not be reported (${(err as Error).message.split("\n")[0]}).`);
      errors++;
    }
  }
  return errors ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);
process.exitCode = command === "count" ? count(rest) : command === "report" ? report(rest[0]) : (console.error(USAGE), 2);
