// LFLAGS's mutations (docs/decisions/2026-10-31-lock-flags-from-graph.md, section 4): each undoes one new check. The
// named test files must fail with it and pass without it. The runner is docs/bench/2026-10-30-lb-design/scripts/mutate.mjs's
// (a run that does not end within LIMIT is stopped and reported apart; a mutation whose text is not found exactly once is
// reported as NOT APPLIED, never counted). Usage (in /w, after npm ci, with no network): node /scripts/mutate.mjs
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const D = "packages/cli/src/security/deliver.ts", J = "packages/cli/src/security/judge.ts";
const T = "packages/cli/test/deliver.test.ts", C = "packages/cli/test/npm-corpus.test.ts";
const BOTH = `${T} ${C}`;
const LIMIT = 300_000;
const mutations = [
  // Section 1, rule 1: the walk follows optional peers again (main's DECLARED).
  ["rule 1: the walk follows optional peers", D, "for (const name of requiredNames(item)) {", "for (const group of DECLARED) for (const name of isObject(item[group]) ? Object.keys(item[group]) : []) {", BOTH],
  // Rule 2: an installed entry's optional peers left out of the requirement check, as on main.
  ["rule 2: an entry's optional peer not checked where it is there", J, "needs: [...requires, ...peers, ...optional],\n", "needs: [...requires, ...peers],\n", BOTH],
  ["rule 2: the project's optional peer not checked where it is there", J, "needs: [...requires, ...peers, ...optional], peers: new Set([...peers, ...optional]", "needs: [...requires, ...peers], peers: new Set([...peers, ...optional]", BOTH],
  ["rule 2: a missing optional peer counted unmet", J, "    if (!found && consumer.optional?.has(name)) continue;\n", "", BOTH],
  ["rule 2: an optional peer that another group names checked as a peer too", J, "meta[name].optional === true && !named.has(name));", "meta[name].optional === true);", BOTH],
  // Section 2, the computation.
  ["flags: dev not taken off by a production edge", J, "if (to.dev && !at.dev && !edge.dev) {", "if (to.dev && !at.dev) {", BOTH],
  ["flags: optional not taken off by a required edge", J, "if (to.optional && !at.optional && !edge.optional) {", "if (to.optional && !at.optional) {", BOTH],
  ["flags: devOptional taken off by any edge from a node outside both trees", J, "if (to.devOptional && !at.devOptional && !at.dev && !at.optional && !edge.dev && !edge.optional) {", "if (to.devOptional && !at.devOptional) {", BOTH],
  ["flags: peer not taken off by a non-peer edge", J, "if (to.peer && !at.peer && !edge.peer) {", "if (to.peer && !at.peer) {", BOTH],
  ["flags: an optional peer makes its target not extraneous", J, "if (to.extraneous && !at.extraneous && !(edge.peer && edge.optional)) {", "if (to.extraneous && !at.extraneous) {", BOTH],
  ["flags: a not extraneous package leaves the one it is installed under extraneous", J, "up?.extraneous; up = up.path === \"\" ? undefined : nodes.get(parentOf(up.path))) up.extraneous = false;", "up?.extraneous; up = up.path === \"\" ? undefined : nodes.get(parentOf(up.path))) break;", BOTH],
  ["flags: a link passes nothing to its target", J, "if (target[flag] && !at[flag]) { target[flag] = false; changed = true; }", "if (false) { target[flag] = false; changed = true; }", BOTH],
  ["flags: no workspace edges from the root", J, "        out.set(requireName(path), { name: requireName(path), dev: false, optional: false, peer: false });\n", "", BOTH],
  ["flags: peers replace dependencies (the groups' order)", J, "    group(item.peerDependencies, name => ({ dev: false, optional: !!(meta[name] !== null && typeof meta[name] === \"object\" && meta[name].optional), peer: true }));\n    group(item.dependencies, () => ({ dev: false, optional: false, peer: false }));\n", "    group(item.dependencies, () => ({ dev: false, optional: false, peer: false }));\n    group(item.peerDependencies, name => ({ dev: false, optional: !!(meta[name] !== null && typeof meta[name] === \"object\" && meta[name].optional), peer: true }));\n", BOTH],
  ["flags: an installed package's devDependencies followed", J, "if (from.top) group(item.devDependencies,", "if (true) group(item.devDependencies,", BOTH],
  ["flags: devOptional written beside dev or optional", J, "flag === \"devOptional\" ? n.devOptional && !n.dev && !n.optional :", "flag === \"devOptional\" ? n.devOptional :", BOTH],
  ["flags: an optional peer meta read as required", J, "optional: !!(meta[name] !== null && typeof meta[name] === \"object\" && meta[name].optional), peer: true", "optional: false, peer: true", BOTH],
  // The PR job's choice of checked entries.
  ["check: the computed flags not compared at all", D, "if (checked && written !== computed) return", "if (false) return", T],
  ["check: an entry whose place changes its flags not checked", D, " || flagsWere.get(path) !== computed;", ";", T],
  ["check: an entry whose written flags changed not checked", D, " || writtenFlags(before) !== written || ", " || ", T],
  ["check: a moved entry not checked", D, "const checked = planned.includes(path) || !before ||", "const checked = !before ||", T],
  ["check: a flag with a value other than true read as absent", J, "if (ENTRY_FLAGS.some(flag => Object.hasOwn(item, flag) && item[flag] !== true)) return null;", "", T],
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
