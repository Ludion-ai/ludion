#!/usr/bin/env node
import { execTool } from "../../verify/src/command.ts";
// The seed pipeline (docs/decisions.md, "The seed pipeline"). Each step reads and writes JSON in one folder, so a
// step can be rerun, and a stopped run resumes where it stopped.
//   node tools/seed/src/cli.ts collect <dir> --package <name> --range "<semver range>" [--since <ISO date>]
//   node tools/seed/src/cli.ts triage <dir> [--model <id>]
//   node tools/seed/src/cli.ts draft <dir> [--model <id>] [--kinds default,behavior,...] [--signal silent|loud] [--limit n]
//   node tools/seed/src/cli.ts check <dir>
//   node tools/seed/src/cli.ts review <dir> [--model <id>]       opus by default; an unchanged draft keeps its review
//   node tools/seed/src/cli.ts revise <dir> --round <n> [--scope check|findings]   fixes round n-1: check = local-check
//     problems only, by the drafting model; findings (default) = review findings once, rules 1, 7, 8 by --content-model (opus)
//   (check, review, and lessons take --round <n> to work on revised drafts)
//   node tools/seed/src/cli.ts lessons <dir> --out <lessons folder>
//   node tools/seed/src/cli.ts ci <dir> --pr <number>            CI's Docker results for the lessons' PR
//   node tools/seed/src/cli.ts fix <dir> --out <lessons folder>   one repair round for lessons CI failed
//   node tools/seed/src/cli.ts bench <dir> --out <lessons folder> FreshBench labels and the harm check
//   node tools/seed/src/cli.ts summary <dir>
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { registry, releases, splitEntries, type Entry } from "./collect.ts";
import { read, write, type RunInfo } from "./io.ts";
import { ask, extractJson, pool } from "./llm.ts";
import { batches, parseVerdicts, triagePrompt, type Verdict } from "./triage.ts";

const gh = (args: string[]) => execTool("gh", args, { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
async function collect(dir: string, pkg: string, range: string, since?: string) {
  mkdirSync(dir, { recursive: true });
  const reg = await registry(pkg, range, fetch, since);
  const { found, missing } = releases(pkg, reg, gh);
  const entries = found.flatMap(splitEntries);
  write(dir, "run.json", { package: pkg, range, ...(since ? { since } : {}), repo: reg.repo, versions: reg.versions.map((v) => v.version), missing, collected_at: new Date().toISOString() } satisfies RunInfo);
  write(dir, "releases.json", found);
  write(dir, "entries.json", entries);
  console.log(`${pkg} ${range}: ${reg.versions.length} versions, ${found.length} with release notes, ${entries.length} entries.${missing.length ? ` No notes: ${missing.join(", ")}.` : ""}`);
}

async function triage(dir: string, model: string) {
  const run = read<RunInfo>(dir, "run.json");
  const entries = read<Entry[]>(dir, "entries.json");
  const done: Verdict[] = existsSync(join(dir, "triage.json")) ? read<Verdict[]>(dir, "triage.json") : [];
  const seen = new Set(done.map((v) => v.id));
  const todo = batches(entries.filter((e) => !seen.has(e.id)));
  let cost = 0;
  const results = await pool(todo, 4, async (batch) => {
    for (let attempt = 1; ; attempt++) {
      const r = await ask(triagePrompt(run.package, batch), model);
      cost += r.costUsd;
      try {
        if (r.isError) throw new Error(`run ended with an error: ${r.answer.slice(0, 200)}`);
        const verdicts = parseVerdicts(extractJson(r.answer), batch);
        done.push(...verdicts);
        write(dir, "triage.json", done);
        return verdicts;
      } catch (err) {
        if (attempt >= 2) throw err;
      }
    }
  });
  const errors = results.filter((r) => r instanceof Error);
  for (const e of errors) console.error(`triage: ${(e as Error).message}`);
  const order = new Map(entries.map((e, i) => [e.id, i]));
  done.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  write(dir, "triage.json", done);
  const candidates = done.filter((v) => v.candidate).length;
  console.log(`triage: ${done.length}/${entries.length} entries sorted, ${candidates} candidates, $${cost.toFixed(2)}.${errors.length ? ` ${errors.length} batches failed; run again to retry them.` : ""}`);
}

async function main(argv: string[]): Promise<number> {
  const [step, dir, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { package: { type: "string" }, range: { type: "string" }, model: { type: "string" }, kinds: { type: "string" }, limit: { type: "string" }, out: { type: "string" }, signal: { type: "string" }, since: { type: "string" }, pr: { type: "string" }, round: { type: "string" }, versions: { type: "string" }, scope: { type: "string" }, "content-model": { type: "string" } } });
  if (!step || !dir) {
    console.error("Usage: node tools/seed/src/cli.ts <collect|triage|draft|check|review|lessons|summary> <dir> [options]");
    return 2;
  }
  if (step === "collect") {
    if (!values.package || !values.range) throw new Error("collect needs --package and --range.");
    await collect(dir, values.package, values.range, values.since);
  } else if (step === "triage") {
    await triage(dir, values.model ?? "claude-sonnet-5-5");
  } else {
    const steps = await import("./steps.ts");
    await steps.run(step, dir, values);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => (process.exitCode = code),
  (err: Error) => {
    console.error(`seed: ${err.message}`);
    process.exitCode = 1;
  },
);
