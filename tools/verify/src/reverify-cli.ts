#!/usr/bin/env node
// The report side of nightly reverify. It reads verify's results; it never runs lesson code.
//   node tools/verify/src/reverify-cli.ts <tonight results.json> [<last night results.json>] --out failing.json [--open-prs]
// --open-prs opens one retraction PR per confirmed failure that has none open (needs gh with a token that can push).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { confirmedFailures, retractionPr, type Failing } from "./reverify.ts";
import type { LessonResult } from "./verify.ts";

const results = (path: string | undefined): LessonResult[] | undefined =>
  path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { results: LessonResult[] }).results : undefined;

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function openPr(f: Failing, runUrl: string): string {
  const branch = `retract/${f.id}`;
  if (run("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number", "--jq", "length"]) !== "0") return `${f.id}: a retraction PR is already open`;
  run("git", ["switch", "-C", branch, "origin/main"]);
  run("git", ["rm", "--quiet", f.file]);
  run("git", ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "--quiet", "-m", `Retract ${f.id}: its evidence no longer holds`]);
  run("git", ["push", "--force", "--quiet", "origin", branch]);
  const { title, body } = retractionPr(f, runUrl);
  const bodyFile = join(mkdtempSync(join(tmpdir(), "reverify-")), "body.md");
  writeFileSync(bodyFile, body);
  return run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", title, "--body-file", bodyFile, "--label", "retract"]);
}

function main(): number {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" }, "open-prs": { type: "boolean" } } });
  const tonight = results(positionals[0]);
  if (!tonight || !values.out) {
    console.error("Usage: node tools/verify/src/reverify-cli.ts <tonight results.json> [<last night results.json>] --out failing.json [--open-prs]");
    return 2;
  }
  const failing = confirmedFailures(tonight, results(positionals[1]));
  writeFileSync(values.out, JSON.stringify({ checked_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), failing }, null, 2) + "\n");
  const unconfirmed = tonight.filter((r) => r.status === "failed").length - failing.length;
  console.log(`${tonight.length} lessons checked; ${failing.length} failing${unconfirmed ? `; ${unconfirmed} failed only on a source or an outage for the first night (counted if they fail again tomorrow)` : ""}.`);
  if (values["open-prs"]) {
    const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    for (const f of failing) console.log(openPr(f, runUrl));
  }
  return 0;
}

process.exitCode = main();
