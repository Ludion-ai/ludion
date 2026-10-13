#!/usr/bin/env node
// ludion: tells your coding assistant what changed in the versions your project installed.
//   ludion sync [--dir <path>] [--model <id>] [--quiet] [--offline]
//   ludion teach <draft.json | - | --draft <base64url>> [--public] [--drafted-by-agent]
// No telemetry: the only network requests are the index shards (sync), source pages (teach), and gh (teach --public).
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ledgerLesson, readLedger, saveEntry } from "./ledger.ts";
import { SUBJECT_REQUEST_URL, subjectFor } from "@ludion/core";
import { directDependencies, readInstalled } from "./lockfile.ts";
import { select, type SyncLesson } from "./match.ts";
import { CONSENT, openPullRequest } from "./publish.ts";
import { lessonLines, readLessonsFile, renderLessons, writeAndWire } from "./render.ts";
import { fetchLessons } from "./shards.ts";
import { check, ghIdentity, isUnverified, ledgerEntry, readDraft, showLesson, toLesson } from "./teach.ts";

const HELP = `ludion: tells your coding assistant what changed in the versions your project installed.

  ludion sync [--dir <path>] [--model <id>] [--quiet] [--offline]
      Read the lockfile, fetch the lessons for the installed versions, leave out what the model
      is measured to know, and write .ludion/lessons.md (imported from CLAUDE.md).
      --quiet prints nothing unless the lessons changed; then it prints them (for session-start hooks).

  ludion teach <draft.json | - | --draft <value>> [--public] [--drafted-by-agent]
      Check a lesson on this machine (tests run only in Docker) and save it to your ledger
      (~/.ludion). A draft without evidence is saved as unverified and reaches only your own projects.
      --public needs evidence; it shows you the whole lesson, asks you to confirm at the terminal, and opens
      a pull request with your own gh.
`;

async function sync(argv: string[]): Promise<number> {
  const { values } = parseArgs({ args: argv, options: { dir: { type: "string", default: "." }, model: { type: "string" }, quiet: { type: "boolean" }, offline: { type: "boolean" } } });
  const dir = resolve(values.dir!);
  const model = values.model ?? process.env.LUDION_MODEL ?? process.env.ANTHROPIC_MODEL;
  const say = (s: string) => values.quiet || console.log(s);
  const installed = readInstalled(dir);

  let index: SyncLesson[] = [];
  let subjects: Set<string> | undefined;
  let inactiveIds: Set<string> | undefined;
  let failed = false;
  if (!values.offline) {
    try {
      ({ lessons: index, subjects, inactiveIds } = await fetchLessons(installed));
    } catch (err) {
      // Without the index, a rewrite would drop every public lesson the project has, so an existing lessons file is
      // left as it is. Sync never blocks the session: with --quiet (the hook) it warns and exits 0.
      failed = true;
      if (readLessonsFile(dir)) {
        console.error(`ludion: could not fetch the index: ${(err as Error).message} Left .ludion/lessons.md as it was. Public lesson status is unknown; saved evidence labels are historical. Run ludion sync again later.`);
        return values.quiet ? 0 : 1;
      }
      console.error(`ludion: could not fetch the index: ${(err as Error).message} Wrote only your ledger's lessons. Run ludion sync again later.`);
    }
  }
  const publicIds = new Set(index.map((l) => l.id));
  const ledger = readLedger()
    .filter((e) => !inactiveIds?.has(e.lesson.id))
    .map((e) => {
      const lesson = ledgerLesson(e);
      // A pending public PR can still be used privately; an old/absent manifest cannot certify that it is active.
      if (e.public && inactiveIds === undefined) lesson.verified = "not verified: public status unknown (offline or index without retirement metadata)";
      return lesson;
    })
    .filter((l) => !publicIds.has(l.id));
  const selection = select([...index, ...ledger], installed, model);
  const summary = selection.kept.length
    ? [...new Set(selection.kept.map(({ lesson, versions }) => `${lesson.package.name} ${versions.join("/")}`))].join(", ")
    : `${installed.npm.size} packages from ${installed.source}, node ${installed.node}`;
  // Installed direct dependencies with no subject in Ludion: named in lessons.md, so the assistant checks them
  // elsewhere, and printed with how to ask for them.
  // A package with a lesson in the ledger isn't uncovered, even if the index has no subject for it.
  const taught = new Set(ledger.map((l) => l.package.name));
  const uncovered = subjects && directDependencies(dir).filter((name) => installed.npm.has(name) && !taught.has(name) && !subjects.has(subjectFor({ ecosystem: "npm", name })));
  const before = readLessonsFile(dir);
  const lessonsMd = renderLessons(selection, summary, new Date(), uncovered);
  const { written, skipped } = writeAndWire(dir, lessonsMd, { privateLessons: selection.kept.some(({ lesson }) => lesson.origin === "ledger") });
  for (const s of skipped) console.error(`ludion: ${s}`);
  // A session-start hook runs after Claude Code has read CLAUDE.md, so a change written now reaches only the next
  // session; the hook's output reaches this one. So --quiet prints the lessons, and only when they changed.
  const now = lessonLines(lessonsMd);
  if (values.quiet && written.includes(".ludion/lessons.md") && (lessonLines(before) !== now || (now && written.includes("CLAUDE.md")))) {
    console.log(`ludion sync updated .ludion/lessons.md after this session read CLAUDE.md. The current lessons:\n\n${lessonsMd}`);
  }
  say(`ludion: ${selection.kept.length} lesson${selection.kept.length === 1 ? "" : "s"} for this project${selection.prunedForModel.length ? ` (${selection.prunedForModel.length} left out: ${model} is measured to know them)` : ""}. Wrote ${written.join(", ")}.`);
  if (uncovered?.length) say(`ludion: no lessons for ${uncovered.length} of this project's dependencies (listed in .ludion/lessons.md). Ask for lessons: ${SUBJECT_REQUEST_URL}`);
  return failed && !values.quiet ? 1 : 0;
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
  if (isUnverified(draft)) {
    if (values.public) {
      console.error("A public lesson needs evidence: a test, or a source with a quote that names the symbol. Add one and teach again, or leave out --public to keep it in your ledger as unverified.");
      return 1;
    }
    draft.evidence = [];
  }
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
  console.log(
    report.unverified
      ? `Saved to your ledger as unverified (no evidence): ${path}. \`ludion sync\` writes it, marked "unverified, yours only", in your projects that use ${lesson.package.name} ${lesson.versions}. To teach it in public, add a test or a source and teach it again with --public.`
      : `Saved to your ledger: ${path}. \`ludion sync\` in any project that uses ${lesson.package.name} ${lesson.versions} now writes it.`,
  );
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
  console.log(`\n${CONSENT}`);
  const ok = await confirm(`\nOpen a pull request to make this lesson public, with the sentence above, signed as @${who.login}? [y/N] `);
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

// exitCode, never process.exit(): exiting while fetch's sockets are still closing trips a libuv assertion on
// Windows (exit code 9 after a successful sync), which a session-start hook would report as a failure.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: Error) => {
    console.error(`ludion: ${err.message}`);
    process.exitCode = 1;
  },
);
