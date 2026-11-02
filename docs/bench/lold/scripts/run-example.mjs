// LOLD: runs examples by ../definitions.md. Usage (Docker only): node run-example.mjs <out dir> <id> [<id> ...]
// With no id, every example runs. --alternative runs the plan's alternative instead (definitions, section 8).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ages, checkOldest, diff, differingPaths, duplicates, times, versionsMoved } from "./verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bench = dirname(here), repo = dirname(dirname(dirname(bench)));
const require = createRequire("/vol/npm12/node_modules/npm/package.json");
const semver = require("semver");

const NPM = ["/vol/npm12/node_modules/npm/bin/npm-cli.js"];
const FLAGS = ["--ignore-scripts", "--no-audit", "--no-fund", "--no-update-notifier", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org", "--cache=/vol/cache"];
const LIMIT = 15 * 60 * 1000;

function npm(dir, args) {
  const res = spawnSync(process.execPath, [...NPM, ...args, ...FLAGS], { cwd: dir, encoding: "utf8", timeout: LIMIT, maxBuffer: 256 * 1024 * 1024 });
  return { status: res.status, timedOut: res.error?.code === "ETIMEDOUT", stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
const tail = text => text.split("\n").slice(-12).join("\n").slice(-1500);
const readLock = dir => JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
const write = (dir, name, text) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), text); };
const copyLock = (from, to) => { mkdirSync(to, { recursive: true }); cpSync(join(from, "package-lock.json"), join(to, "package-lock.json")); };

function loadExamples() {
  const rows = JSON.parse(readFileSync(join(bench, "examples.json"), "utf8")).examples;
  const hand = JSON.parse(readFileSync(join(bench, "examples.hand.json"), "utf8")).examples;
  return [...rows, ...hand];
}

/** Builds the base and returns the two manifests, or { noBase }. */
async function makeBase(example, dir) {
  mkdirSync(dir, { recursive: true });
  let before = null;
  if (example.kind === "repo") {
    for (const file of ["package.json", "package-lock.json"]) cpSync(join(repo, example.project, file), join(dir, file));
  } else {
    if (example.kind === "row") {
      const doc = await times(example.name);
      if (!doc.time[example.from]) return { noBase: `no publish time for ${example.from}` };
      before = new Date(Date.parse(doc.time[example.from]) + 3600e3).toISOString();
    } else before = example.base_before;
    const dependencies = example.kind === "row" ? { [example.name]: example.from } : example.project_dependencies;
    write(dir, "package.json", `${JSON.stringify({ name: "lold-example", version: "1.0.0", private: true, dependencies }, null, 2)}\n`);
    const run = npm(dir, ["install", "--package-lock-only", `--before=${before}`]);
    if (run.status !== 0) return { noBase: tail(run.stderr) || `exit ${run.status}`, before };
  }
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const final = structuredClone(manifest), pinned = structuredClone(manifest);
  const direct = manifest.dependencies?.[example.name] !== undefined;
  if (direct) {
    final.dependencies[example.name] = example.v;
    pinned.dependencies[example.name] = example.v;
  } else {
    pinned.overrides = { [`${example.name}@${example.from}`]: example.v };
  }
  return { before, pinned: `${JSON.stringify(pinned, null, 2)}\n`, final: `${JSON.stringify(final, null, 2)}\n` };
}

/** The two steps with real npm and no replacement. */
function normal(baseDir, dir, manifests, extra) {
  rmSync(dir, { recursive: true, force: true });
  copyLock(baseDir, dir);
  write(dir, "package.json", manifests.pinned);
  const one = npm(dir, ["install", "--package-lock-only", ...extra]);
  if (one.status !== 0) return { ok: false, step: 1, status: one.status, timedOut: one.timedOut, stderr: tail(one.stderr) };
  write(dir, "package.json", manifests.final);
  const two = npm(dir, ["install", "--package-lock-only", ...extra]);
  if (two.status !== 0) return { ok: false, step: 2, status: two.status, timedOut: two.timedOut, stderr: tail(two.stderr) };
  return { ok: true };
}

function lsProblems(dir) {
  const run = npm(dir, ["ls", "--all", "--package-lock-only", "--json"]);
  try { return { problems: JSON.parse(run.stdout).problems ?? [], status: run.status }; }
  catch { return { problems: [`unreadable output, exit ${run.status}: ${tail(run.stderr)}`], status: run.status }; }
}

/** I5 and I6 on a result directory. */
function npmAccepts(baseProblems, dir, scratch) {
  const failures = [];
  rmSync(scratch, { recursive: true, force: true });
  copyLock(dir, scratch);
  cpSync(join(dir, "package.json"), join(scratch, "package.json"));
  const ci = npm(scratch, ["ci", "--dry-run"]);
  if (ci.status !== 0) failures.push(`I5: npm ci --dry-run exit ${ci.status}: ${tail(ci.stderr)}`);
  const ls = lsProblems(scratch);
  const fresh = ls.problems.filter(p => !baseProblems.includes(p));
  if (fresh.length) failures.push(`I5: npm ls reports ${fresh.length} new: ${fresh.slice(0, 5).join(" | ").slice(0, 800)}`);
  const before = readFileSync(join(scratch, "package-lock.json"));
  const again = npm(scratch, ["install", "--package-lock-only"]);
  if (again.status !== 0) failures.push(`I6: npm install exit ${again.status}: ${tail(again.stderr)}`);
  else if (!before.equals(readFileSync(join(scratch, "package-lock.json")))) failures.push("I6: npm install changed the lockfile");
  return { failures, ls_problems: ls.problems.length, new_ls_problems: fresh.length };
}

async function comparison(base, adv, label, lockDir, run, at) {
  if (!run.ok) return { label, built: false, ...run };
  const lock = readLock(lockDir);
  return { label, built: true, ...(await ages(base, lock, adv, at)), removed_paths: diff(base, lock).removed.length, duplicate_names: duplicates(lock).length, ls_problems: lsProblems(lockDir).problems.length };
}

async function runOne(example, root) {
  const dir = join(root, "work", example.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const out = { id: example.id, name: example.name, from: example.from, v: example.v, advisory: example.advisory, why: example.why, vulnerable: example.vulnerable, started_at: new Date(started).toISOString() };
  const baseDir = join(dir, "base");
  const made = await makeBase(example, baseDir);
  out.base_before = made.before ?? null;
  if (made.noBase) return { ...out, outcome: "no_base", reason: made.noBase };
  const base = readLock(baseDir);
  out.base = { lockfile_version: base.lockfileVersion, entries: Object.keys(base.packages).length - 1, duplicate_names: duplicates(base).length };
  const baseProblems = lsProblems(baseDir).problems;
  out.base.ls_problems = baseProblems.length;
  out.base.vulnerable_copies = Object.entries(base.packages).filter(([path, e]) => path && (e.name ?? path.slice(path.lastIndexOf("node_modules/") + 13)) === example.name && semver.satisfies(e.version, example.vulnerable, { loose: true })).map(([path, e]) => `${path}@${e.version}`);

  const doc = await times(example.name);
  const vTime = doc.time[example.v];
  if (example.kind === "row") out.t = new Date(Math.max(Date.parse(example.advisory_published), Date.parse(example.fix_published))).toISOString();
  else out.t = new Date(Date.parse(vTime) + 3600e3).toISOString();
  out.v_published = vTime ?? null;
  const adv = { name: example.name, from: example.from, v: example.v, vulnerable: example.vulnerable, t: out.t };

  // The prototype.
  const oldestDir = join(dir, "oldest");
  copyLock(baseDir, oldestDir);
  write(oldestDir, "package.json", made.final);
  write(dir, "pinned.json", made.pinned);
  write(dir, "final.json", made.final);
  const job = { ...adv, pinnedManifest: join(dir, "pinned.json"), finalManifest: join(dir, "final.json"), baseLock: join(baseDir, "package-lock.json"), out: join(dir, "oldest-report.json") };
  write(dir, "job.json", JSON.stringify(job));
  const proc = spawnSync(process.execPath, [join(here, "oldest.mjs"), oldestDir, join(dir, "job.json")], { encoding: "utf8", timeout: LIMIT, maxBuffer: 64 * 1024 * 1024 });
  if (!existsSync(job.out)) return { ...out, outcome: "failed", reason: proc.error?.code === "ETIMEDOUT" ? "timeout" : `oldest.mjs exit ${proc.status}: ${tail(proc.stderr)}`, took_s: (Date.now() - started) / 1e3 };
  const report = JSON.parse(readFileSync(job.out, "utf8"));
  out.picks = report.picks;
  // Arborist also asks for a peer's version while it loads a new package's peer set, even when a locked copy then
  // stays. Such an answer is not an unmet requirement: only a stop that made npm's run fail stops the example. A
  // requirement left unmet any other way fails I5.
  const uniqueStops = [...new Map(report.stops.map(s => [`${s.req}\0${s.reason}`, s])).values()];
  const stoppedRun = report.failure?.code === "LOLD_STOP";
  out.stops = stoppedRun ? uniqueStops : [];
  out.probe_stops = stoppedRun ? [] : uniqueStops;
  out.excluded_totals = report.picks.reduce((sum, p) => {
    for (const key of ["no_time", "after_t", "withdrawn", "deprecated", "advisory"]) sum[key] += p.counts?.[key] ?? 0;
    return sum;
  }, { no_time: 0, after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0 });
  out.excluded_names = report.picks.filter(p => p.counts && (p.counts.deprecated || p.counts.advisory || p.counts.withdrawn)).map(p => p.req);

  // Comparison with real npm, whatever the prototype's outcome.
  const normalDir = join(dir, "normal"), normalTDir = join(dir, "normal-t");
  const runPlain = normal(baseDir, normalDir, made, []);
  const plainAt = Date.now();
  const runAtT = normal(baseDir, normalTDir, made, [`--before=${out.t}`]);
  out.normal = await comparison(base, adv, "normal", normalDir, runPlain, plainAt);
  out.normal_at_t = await comparison(base, adv, "normal at T", normalTDir, runAtT, Date.parse(out.t));

  if (stoppedRun) return { ...out, outcome: "stopped_no_allowed", reason: uniqueStops, tool_failure: report.failure, took_s: (Date.now() - started) / 1e3 };
  if (report.failure || report.tarball_requests.length || report.read_errors.length) {
    return { ...out, outcome: "failed", reason: report.failure?.message ?? "see tarball_requests and read_errors", failure_code: report.failure?.code ?? null, peer_conflict: report.failure?.code === "ERESOLVE", tarball_requests: report.tarball_requests, read_errors: report.read_errors, took_s: (Date.now() - started) / 1e3 };
  }

  const lock = readLock(oldestDir);
  const checked = await checkOldest(base, lock, adv);
  const accepted = npmAccepts(baseProblems, oldestDir, join(dir, "scratch"));
  const shape = diff(base, lock);
  out.items = checked.items;
  out.moved_non_v = checked.items.length;
  out.all_oldest = checked.items.every(i => i.oldest);
  out.removed_paths = shape.removed.length;
  out.flag_only_paths = shape.flagsOnly.length;
  out.duplicate_names = duplicates(lock).length;
  out.duplicates_new_vs_base = duplicates(lock).filter(line => !duplicates(base).includes(line));
  out.ls_problems = accepted.ls_problems;
  out.new_ls_problems = accepted.new_ls_problems;
  out.youngest_age_at_t_hours = checked.items.reduce((min, i) => (i.age_at_t_hours !== null && (min === null || i.age_at_t_hours < min) ? i.age_at_t_hours : min), null);
  out.install_scripts = checked.items.filter(i => i.has_install_script).map(i => `${i.name}@${i.to}`);
  out.engines_not_node24 = checked.items.filter(i => i.engines_not_node24).map(i => `${i.name}@${i.to}`);
  if (runPlain.ok) out.differing_paths_vs_normal = differingPaths(base, lock, readLock(normalDir)).length;
  if (runAtT.ok) out.differing_paths_vs_normal_at_t = differingPaths(base, lock, readLock(normalTDir)).length;
  // Not part of the outcome: the same checks on npm's own answer at T, to show that they can fail.
  if (runAtT.ok) out.checks_on_normal_at_t_fail = (await checkOldest(base, readLock(normalTDir), adv)).failures.length;
  out.failures = [...checked.failures, ...accepted.failures];
  out.outcome = out.failures.length ? "failed" : "built";
  out.took_s = (Date.now() - started) / 1e3;
  return out;
}

/** The plan's alternative: resolve at T with npm's own flags, a floor of 72 hours on every version but V. */
async function runAlternative(example, root) {
  const dir = join(root, "work-alt", example.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = { id: example.id, name: example.name, from: example.from, v: example.v };
  const baseDir = join(dir, "base");
  const made = await makeBase(example, baseDir);
  if (made.noBase) return { ...out, outcome: "no_base", reason: made.noBase };
  const base = readLock(baseDir);
  const baseProblems = lsProblems(baseDir).problems;
  const doc = await times(example.name);
  const t = example.kind === "row" ? Math.max(Date.parse(example.advisory_published), Date.parse(example.fix_published)) : Date.parse(doc.time[example.v]) + 3600e3;
  out.t = new Date(t).toISOString();
  const floor = new Date(t - 72 * 3600e3).toISOString();
  out.before = floor;
  const adv = { name: example.name, from: example.from, v: example.v, vulnerable: example.vulnerable, t: floor };
  const lockDir = join(dir, "alt");
  const run = normal(baseDir, lockDir, made, [`--before=${floor}`, `--min-release-age-exclude=${example.name}`]);
  if (!run.ok) return { ...out, outcome: "failed", reason: run.stderr, peer_conflict: /ERESOLVE/.test(run.stderr ?? ""), etarget: /ETARGET|No matching version/.test(run.stderr ?? "") };
  const lock = readLock(lockDir);
  const failures = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + 13);
    if (path && name === example.name && semver.satisfies(entry.version, example.vulnerable, { loose: true })) failures.push(`I1: ${path} still holds ${entry.version}`);
  }
  const moved = versionsMoved(base, lock, adv);
  let youngest = null;
  for (const item of moved) {
    const published = (await times(item.name)).time[item.to];
    if (!published || Date.parse(published) > Date.parse(floor)) failures.push(`floor: ${item.path} ${item.to} published ${published ?? "unknown"}, after T - 72h`);
    const hours = published ? Math.round((t - Date.parse(published)) / 36e4) / 10 : null;
    if (hours !== null && (youngest === null || hours < youngest)) youngest = hours;
  }
  const accepted = npmAccepts(baseProblems, lockDir, join(dir, "scratch"));
  failures.push(...accepted.failures);
  return { ...out, outcome: failures.length ? "failed" : "built", moved_non_v: moved.length, youngest_age_at_t_hours: youngest, duplicate_names: duplicates(lock).length, new_ls_problems: accepted.new_ls_problems, failures };
}

const args = process.argv.slice(2);
const alternative = args[0] === "--alternative";
if (alternative) args.shift();
const [root, ...ids] = args;
const resultsDir = join(root, alternative ? "results-alternative" : "results");
mkdirSync(resultsDir, { recursive: true });
for (const example of loadExamples().filter(e => !ids.length || ids.includes(e.id))) {
  let result;
  try { result = await (alternative ? runAlternative : runOne)(example, root); }
  catch (error) { result = { id: example.id, name: example.name, outcome: "failed", reason: `run-example: ${String(error.stack ?? error).slice(0, 1500)}` }; }
  writeFileSync(join(resultsDir, `${example.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${new Date().toISOString()} ${example.id} ${example.name} ${example.from}->${example.v} ${result.outcome} moved=${result.moved_non_v ?? "-"} failures=${result.failures?.length ?? "-"} took=${result.took_s ?? "-"}s`);
  rmSync(join(root, alternative ? "work-alt" : "work", example.id), { recursive: true, force: true });
}
