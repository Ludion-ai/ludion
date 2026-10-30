// LV4b: re-apply the mutations of #214's cloud review (comment 6517309422) and show each is caught.
// Runs inside Docker on a copy of the tree. Each mutation edits one file with split/join, runs the tests, restores.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const CLI = "packages/cli/src/security/cli.ts", FACTS = "packages/cli/src/security/npm-facts.ts";
const EXACT = "fix.reason === `Gate 2 stops this fix: ${choice.note}`";
const SET = "[...new Set<string>(ids)]";
const mutations = [
  ["undo LV4 cli.ts: always print the note", CLI, EXACT + ' ? "" : plain(choice.note)', "plain(choice.note)"],
  ["undo LV4 npm-facts.ts: keep repeated ids", FACTS, SET, "ids"],
  ["osvIds drops the last distinct id", FACTS, SET, `(u => u.length > 1 ? u.slice(0, -1) : u)(${SET})`],
  ["osvIds sorts the ids", FACTS, SET, `${SET}.sort()`],
  ["osvIds keeps the order of last occurrences", FACTS, SET, "[...new Set<string>([...ids].reverse())].reverse()"],
  ["osvIds drops a repeated MAL- id", FACTS, SET, `${SET}.filter((id: string) => !(id.startsWith("MAL-") && ids.indexOf(id) !== ids.lastIndexOf(id)))`],
  ["osvIds de-duplicates on the prefix before the first dash", FACTS, SET, `ids.filter((id: string, i: number) => ids.findIndex((o: string) => o.split("-")[0] === id.split("-")[0]) === i)`],
  ["osvIds de-duplicates on the prefix before the second dash", FACTS, SET, `ids.filter((id: string, i: number) => ids.findIndex((o: string) => o.split("-").slice(0, 2).join("-") === id.split("-").slice(0, 2).join("-")) === i)`],
  ["cli.ts drops the note whenever the fix has a reason", CLI, EXACT, `(${EXACT} || !!fix.reason)`],
  ["cli.ts drops the note whenever no version was chosen", CLI, EXACT, `(${EXACT} || !choice.chosen)`],
  ["cli.ts drops the note whenever the reason starts with Gate 2", CLI, EXACT, `(${EXACT} || !!fix.reason?.startsWith("Gate 2"))`],
  ["cli.ts drops the note of every choice after a fix's first", CLI, EXACT, `(${EXACT} || (fix.version_choice ?? []).indexOf(choice) > 0)`],
  ["cli.ts drops the note together with the Passed over list", CLI, "if (line) console.log", "if (line && !fix.reason?.includes(choice.note)) console.log"],
];
const files = ["packages/cli/test/patch-cli.test.ts", "packages/cli/test/judge.test.ts", "packages/cli/test/dependencies.test.ts", "packages/cli/test/candidate-judge.test.ts", "packages/cli/test/judge-cli.test.ts"];
let caught = 0;
for (const [name, file, from, to] of mutations) {
  const original = readFileSync(file, "utf8");
  const count = original.split(from).length - 1;
  if (count !== 1) { console.log(`NOT APPLIED (${count} matches): ${name}`); continue; }
  writeFileSync(file, original.split(from).join(to));
  try {
    const run = spawnSync("npx", ["vitest", "run", ...files], { encoding: "utf8", timeout: 300_000 });
    const out = run.stdout + run.stderr;
    const tests = /Tests\s+([^\n]+)/.exec(out)?.[1]?.replace(/\x1b\[[0-9;]*m/g, "").trim() ?? "no summary";
    const ok = run.status !== 0;
    if (ok) caught++;
    console.log(`${ok ? "CAUGHT  " : "SURVIVES"} ${name} — exit ${run.status}; ${tests}`);
  } finally { writeFileSync(file, original); }
}
console.log(`caught ${caught} of ${mutations.length}`);
