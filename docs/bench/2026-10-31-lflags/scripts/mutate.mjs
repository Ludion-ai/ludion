// #240's mutations (docs/decisions/2026-10-31-lock-flags-from-graph.md, section 4, for section 1; docs/decisions/2026-10-31-flag-only-entries-gate2.md, section 2): each undoes one new check. The
// named test files must fail with it and pass without it. The runner is docs/bench/2026-10-30-lb-design/scripts/mutate.mjs's
// (a run that does not end within LIMIT is stopped and reported apart; a mutation whose text is not found exactly once is
// reported as NOT APPLIED, never counted). Usage (in /w, after npm ci, with no network): node /scripts/mutate.mjs
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const D = "packages/cli/src/security/deliver.ts", J = "packages/cli/src/security/judge.ts";
const T = "packages/cli/test/deliver.test.ts", C = "packages/cli/test/npm-corpus.test.ts";
const BOTH = `${T} ${C}`;
const L = "packages/cli/src/security/judge-cli.ts", K = "packages/cli/src/security/candidate-judge.ts";
const G = `packages/cli/test/judge.test.ts packages/cli/test/candidate-judge.test.ts packages/cli/test/judge-cli.test.ts`;
const LIMIT = 300_000;
const mutations = [
  // Section 1, rule 1: the walk follows optional peers again (main's DECLARED).
  ["rule 1: the walk follows optional peers", D, "for (const name of requiredNames(item)) {", "for (const group of DECLARED) for (const name of isObject(item[group]) ? Object.keys(item[group]) : []) {", BOTH],
  // Rule 2: an installed entry's optional peers left out of the requirement check, as on main.
  ["rule 2: an entry's optional peer not checked where it is there", J, "needs: [...requires, ...peers, ...optional],\n", "needs: [...requires, ...peers],\n", BOTH],
  ["rule 2: the project's optional peer not checked where it is there", J, "needs: [...requires, ...peers, ...optional], peers: new Set([...peers, ...optional]", "needs: [...requires, ...peers], peers: new Set([...peers, ...optional]", BOTH],
  ["rule 2: a missing optional peer counted unmet", J, "    if (!found && consumer.optional?.has(name)) continue;\n", "", BOTH],
  ["rule 2: an optional peer that another group names checked as a peer too", J, "meta[name].optional === true && !named.has(name));", "meta[name].optional === true);", BOTH],
  // Gate 2 on entries whose flags alone changed (docs/decisions/2026-10-31-flag-only-entries-gate2.md).
  ["gate 2: flag-only entries not passed to the judge", L, "flagged: lockFlagChanges(lock.before, lock.after),", "flagged: [],", G],
  ["gate 2: patch's judge does not ask for their facts", K, "[...lock.entries, ...lock.flagged].map(", "lock.entries.map(", G],
  ["gate 2: ludion judge does not ask for their facts", L, "[...lock.entries, ...lock.flagged].map(", "lock.entries.map(", G],
  ["gate 2: an entry whose flags did not change counted", J, " && flags(before[e.path]) !== flags(after[e.path]);", ";", G],
  ["gate 2: an entry whose integrity changed counted as flag-only", J, " && b.integrity === e.integrity && flags(", " && flags(", G],
  ["gate 2: its MAL- record ignored", J, "if (fact.malicious.length) add({ gate: 2, package: e.name,", "if (false) add({ gate: 2, package: e.name,", G],
  ["gate 2: its withdrawal ignored", J, "if (!fact.present) add({ gate: 2, package: e.name,", "if (false) add({ gate: 2, package: e.name,", G],
  ["gate 2: its deprecation ignored", J, "if (fact.deprecated) add({ gate: 2, package: e.name,", "if (false) add({ gate: 2, package: e.name,", G],
  ["gate 2: no facts for it passes", J, "if (!fact) { add({ gate: 2, package: e.name, effect: \"stop\", message: `No registry facts for ${what}; undecidable.` }); undecidable = true; continue; }", "if (!fact) continue;", G],
  ["gate 2: its advisories not reported", J, "if (fact.advisories.length) add({ gate: 1, package: e.name,", "if (false) add({ gate: 1, package: e.name,", G],
  // Review 6541119866: N1 (mutations 3 and 4) and N2 (mutation 8).
  ["N1: optional left out of the flag list", D, "const NPM_FLAGS = [\"dev\", \"optional\", \"devOptional\", \"peer\"];", "const NPM_FLAGS = [\"dev\", \"devOptional\", \"peer\"];", T],
  ["N1: peer left out of the flag list", D, "const NPM_FLAGS = [\"dev\", \"optional\", \"devOptional\", \"peer\"];", "const NPM_FLAGS = [\"dev\", \"optional\", \"devOptional\"];", T],
  ["N2: name left out of the comparison", D, "const rest = (item: Record<string, unknown>) => Object.fromEntries(Object.entries(item).filter(([key]) => !NPM_FLAGS.includes(key)));", "const rest = (item: Record<string, unknown>) => Object.fromEntries(Object.entries(item).filter(([key]) => !NPM_FLAGS.includes(key) && key !== \"name\"));", T],
];
/** "pass", "fail", or "timeout" when the run does not end within LIMIT; then its whole process group is killed. */
const vitest = files => new Promise(resolve => {
  const child = spawn("npx", ["vitest", "run", "--project", "node", "--maxWorkers=2", ...files.split(" ")], { stdio: "ignore", detached: true, env: { ...process.env, NO_COLOR: "1" } });
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve("timeout"); }, LIMIT);
  child.on("exit", code => { clearTimeout(timer); resolve(code === 0 ? "pass" : "fail"); });
});
const RESULTS = process.env.MUTATE_RESULTS, HEAD = process.env.LB_HEAD ?? "unknown";
const done = new Map();
if (RESULTS && existsSync(RESULTS)) for (const line of readFileSync(RESULTS, "utf8").split("\n")) {
  const [head, result, seconds, name] = line.split("\t");
  if (head === HEAD && name) done.set(name, { result, seconds });
}
const ONLY = process.env.MUTATE_ONLY ? new Set(process.env.MUTATE_ONLY.split(",").map(Number)) : null;
const run = [...mutations.entries()].filter(([i]) => !ONLY || ONLY.has(i + 1));
let caught = 0, timedOut = 0, applied = 0;
for (const [i, [name, file, from, to, test]] of run) {
  const original = readFileSync(file, "utf8");
  if (original.split(from).length !== 2) { console.log(`${i + 1}. NOT APPLIED  ${name} (the text is not found exactly once)`); continue; }
  applied++;
  const earlier = done.get(name);
  let result, seconds;
  if (earlier) ({ result, seconds } = earlier);
  else {
    writeFileSync(file, original.replace(from, to));
    const started = Date.now();
    result = await vitest(test);
    writeFileSync(file, original);
    seconds = Math.round((Date.now() - started) / 1000);
    if (RESULTS) appendFileSync(RESULTS, `${HEAD}\t${result}\t${seconds}\t${name}\n`);
  }
  if (result !== "pass") caught++;
  if (result === "timeout") timedOut++;
  const label = { fail: "caught", timeout: `caught: no end within ${LIMIT / 1000} s`, pass: "NOT CAUGHT" }[result];
  console.log(`${i + 1}. ${label}  ${name} — ${test} (${seconds} s${earlier ? ", recorded by an earlier run" : ""})`);
}
const clean = [];
for (const t of new Set(run.map(([, m]) => m[4]))) clean.push(`${t}: ${await vitest(t)}`);
if (clean.some(line => !line.endsWith(": pass"))) { console.log("RUN VOID: a test file fails without mutations, so no result of this run counts."); process.exitCode = 1; }
console.log(`${caught} of ${applied} applied mutations caught (${run.length} run, ${mutations.length} in all), ${timedOut} of them by the time limit; without mutations: ${clean.join(", ")}`);
