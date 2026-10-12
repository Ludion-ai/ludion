#!/usr/bin/env node
// Builds docs/demo/sync-vitest.cast (asciinema v2) from recorded output only: the two answers come from the Done 3 B
// runs (docs/bench/2026-10-11-done3/, question vitest-5-0-0-14-b, Claude Code with default tools in a vitest 5.0.3
// project), and the sync and grep output from running ludion sync in a copy of that project (sync-output.txt,
// grep-output.txt). Nothing is typed into a model here; the cast replays what was measured.
//   node docs/demo/make-cast.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const bench = join(here, "../bench/2026-10-11-done3");
const QUESTION_ID = "vitest-5-0-0-14-b";
const WIDTH = 100;

const answerOf = (label: string) =>
  (JSON.parse(readFileSync(join(bench, `answers-B-${label}.json`), "utf8")) as { answers: { id: string; answer: string }[] }).answers.find((a) => a.id === QUESTION_ID)!.answer;
const question = (JSON.parse(readFileSync(join(bench, "questions.json"), "utf8")) as { id: string; question: string }[]).find((q) => q.id === QUESTION_ID)!.question;

/** Wrap text to the terminal's width at spaces. */
export function wrap(text: string, width = WIDTH): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      if (line && (line + " " + word).length > width) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

type Event = [number, "o", string];
const events: Event[] = [];
let t = 0.5;
const out = (s: string, after = 0) => {
  events.push([Number(t.toFixed(3)), "o", s]);
  t += after;
};
const DIM = "\u001b[2m";
const RESET = "\u001b[0m";
const comment = (s: string) => {
  for (const l of wrap(s, WIDTH - 2)) out(`${DIM}# ${l}${RESET}\r\n`, 0.05);
  t += 1.2;
};
const type = (cmd: string) => {
  out("$ ", 0.3);
  for (const ch of cmd) out(ch, 0.035);
  out("\r\n", 0.6);
};
const print = (text: string, perLine = 0.12) => {
  for (const l of wrap(text)) out(`${l}\r\n`, perLine);
  t += 1.5;
};

comment("Replay of recorded runs (docs/bench/2026-10-11-done3, question vitest-5-0-0-14-b): Claude Code with its default tools, in a project with vitest 5.0.3 installed.");
type("grep vitest package.json");
print('  "devDependencies": { "vitest": "5.0.3", "@vitest/browser-playwright": "5.0.3", "playwright": "1.64.0" }');
comment("Without Ludion:");
type(`claude -p "${question}"`);
t += 3;
print(answerOf("project"), 0.25);
comment("Wrong for vitest 5: inline projects inherit the root config by default. Code written the vitest 4 way still runs, without an error.");
t += 2;
type("npx ludion-ai sync");
t += 1.5;
print(readFileSync(join(here, "sync-output.txt"), "utf8").trimEnd());
type("grep extends .ludion/lessons.md");
print(readFileSync(join(here, "grep-output.txt"), "utf8").trimEnd(), 0.2);
comment("With Ludion (the same question, a new session):");
type(`claude -p "${question}"`);
t += 3;
print(answerOf("project-sync"), 0.25);
t += 4;
out("");

const header = { version: 2, width: WIDTH, height: 34, title: "ludion sync: vitest 5 inline projects inherit the root config", env: { TERM: "xterm-256color", SHELL: "/bin/bash" } };
writeFileSync(join(here, "sync-vitest.cast"), [JSON.stringify(header), ...events.map((e) => JSON.stringify(e))].join("\n") + "\n");
console.log(`Wrote sync-vitest.cast: ${events.length} events, ${t.toFixed(0)} seconds.`);
