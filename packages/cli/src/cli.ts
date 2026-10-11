#!/usr/bin/env node
// ludion: tells your coding assistant what changed in the versions your project installed.
//   ludion sync [--dir <path>] [--model <id>] [--quiet] [--offline]
//   ludion teach <draft.json | - | --draft <base64url>> [--public] [--drafted-by-agent]
// No telemetry: the only network requests are the index shards (sync), source pages (teach), and gh (teach --public).
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ledgerLesson, readLedger, saveEntry } from "./ledger.ts";
import { readInstalled } from "./lockfile.ts";
import { select, type SyncLesson } from "./match.ts";
import { openPullRequest } from "./publish.ts";
import { renderLessons, writeAndWire } from "./render.ts";
import { fetchLessons } from "./shards.ts";
import { check, ghIdentity, ledgerEntry, readDraft, showLesson, toLesson } from "./teach.ts";

const HELP = `ludion: tells your coding assistant what changed in the versions your project installed.

  ludion sync [--dir <path>] [--model <id>] [--quiet] [--offline]
      Read the lockfile, fetch the lessons for the installed versions, leave out what the model
      is measured to know, and write .ludion/lessons.md (imported from CLAUDE.md).

  ludion teach <draft.json | - | --draft <value>> [--public] [--drafted-by-agent]
      Check a lesson on this machine (tests run only in Docker) and save it to your ledger
      (~/.ludion). --public shows you the whole lesson, asks you to confirm at the terminal, and opens
      a pull request with your own gh.
`;

async function sync(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { dir: { type: "string", default: "." }, model: { type: "string" }, quiet: { type: "boolean" }, offline: { type: "boolean" } } });
  const dir = resolve(values.dir!);
  const model = values.model ?? process.env.LUDION_MODEL ?? process.env.ANTHROPIC_MODEL;
  const say = (s: string) => values.quiet || console.log(s);
  const installed = readInstalled(dir);

  let index: SyncLesson[] = [];
  if (!values.offline) {
    try {
      index = (await fetchLessons(installed)).lessons;
    } catch (err) {
      // A sync that can't reach the index still writes the ledger's lessons; it never blocks the session.
      console.error(`ludion: could not fetch the index (${(err as Error).message}); using your ledger only.`);
    }
  }
  const publicIds = new Set(index.map((l) => l.id));
  const ledger = readLedger().map(ledgerLesson).filter((l) => !publicIds.has(l.id));
  const selection = select([...index, ...ledger], installed, model);
  const summary = selection.kept.length
    ? [...new Set(selection.kept.map(({ lesson, versions }) => `${lesson.package.name} ${versions.join("/")}`))].join(", ")
    : `${installed.npm.size} packages from ${installed.source}, node ${installed.node}`;
  const { written, skipped } = writeAndWire(dir, renderLessons(selection, summary, new Date()));
  for (const s of skipped) console.error(`ludion: ${s}`);
  say(`ludion: ${selection.kept.length} lesson${selection.kept.length === 1 ? "" : "s"} for this project${selection.prunedForModel.length ? ` (${selection.prunedForModel.length} left out: ${model} is measured to know them)` : ""}. Wrote ${written.join(", ")}.`);
  return 0;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function teach(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { draft: { type: "string" }, public: { type: "boolean" }, "drafted-by-agent": { type: "boolean" } },
  });
  const source = values.draft ?? positionals[0];
  if (!source) {
    console.error("Give a draft: ludion teach draft.json, ludion teach -, or ludion teach --draft <value>.");
    return 2;
  }
  const draft = readDraft(source);
  if (values["drafted-by-agent"]) draft.drafted_by = "agent";
  // The teacher's GitHub account matters only for a public lesson; without --public, gh isn't called.
  const who = values.public ? ghIdentity() : undefined;
  const now = new Date();
  const lesson = toLesson(draft, who, now);
  console.log(showLesson(lesson));
  console.log("");

  const report = await check(lesson);
  console.log(`Tests: ${report.tests}. Sources: ${report.sources}.`);
  if (report.problems.length) {
    console.error(`\nNot saved. Fix these and teach again:\n- ${report.problems.join("\n- ")}`);
    return 1;
  }
  const entry = ledgerEntry(lesson, report, now);
  const path = saveEntry(entry);
  console.log(`Saved to your ledger: ${path}. \`ludion sync\` in any project that uses ${lesson.package.name} ${lesson.versions} now writes it.`);
  if (!values.public) return 0;

  if (!who) {
    console.error("To teach in public, sign in to GitHub with gh first (gh auth login), then run this again with --public.");
    return 1;
  }
  // The person signs: --public asks at a terminal, and there is no flag to skip it, so an assistant can't answer for them.
  if (!process.stdin.isTTY) {
    console.error("Teaching in public needs you at a terminal to confirm. Run this command yourself; it stays in your ledger until then.");
    return 1;
  }
  const ok = await confirm(`\nOpen a pull request to make this lesson public, signed as @${who.login}? [y/N] `);
  if (!ok) {
    console.log("Not published. It stays in your ledger.");
    return 0;
  }
  const url = openPullRequest(lesson, who);
  saveEntry({ ...entry, public: { pr_url: url } });
  console.log(`Pull request opened in your name: ${url}\nCI runs the evidence; once a maintainer merges it, every \`ludion sync\` can write it.`);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "sync") return sync(rest);
  if (command === "teach") return teach(rest);
  console.log(HELP);
  return command === undefined || command === "help" || command === "--help" ? 0 : 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => {
    console.error(`ludion: ${err.message}`);
    process.exit(1);
  },
);
