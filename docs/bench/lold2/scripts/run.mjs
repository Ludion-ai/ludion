// LOLD2: the product's resolver (packages/cli/src/security/oldest.ts) on LOLD's examples, with the real npm 12.2.1.
// Docker only: the tree copied to /vol/app with its dependencies, npm 12.2.1 in /vol/npm12, a network for metadata.
// Usage: node run.mjs <out dir> [<id> ...]
// The script the product writes starts the npm of the image's global folder; here the same script starts /vol/npm12's.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { candidateRefusal, judgeNpmCandidate } from "/vol/app/packages/cli/src/security/candidate-judge.ts";
import { fixResolution, noAnswerIn, noAnswerReason, notOldest, recheckOldest, resolutionAssert, resolveOldest, resolverScript, tableFile, unneededMoves } from "/vol/app/packages/cli/src/security/oldest.ts";
import { lockEntries, newUnmetRequirements } from "/vol/app/packages/cli/src/security/judge.ts";

const repo = "/vol/app", lold = join(repo, "docs/bench/lold");
const NPM_DIR = "/vol/npm12/node_modules/npm/", NPM = `${NPM_DIR}bin/npm-cli.js`;
const FLAGS = ["--ignore-scripts", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org"];
const LIMIT = 15 * 60 * 1000;
const env = { ...process.env, npm_config_cache: "/vol/cache", npm_config_update_notifier: "false" };
const npm = (dir, args) => {
  const r = spawnSync(process.execPath, [NPM, ...args, ...FLAGS], { cwd: dir, encoding: "utf8", timeout: LIMIT, maxBuffer: 256 * 1024 * 1024, env });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const tail = text => text.split("\n").slice(-12).join("\n").slice(-1500);
const write = (dir, name, text) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, name), text); };
const json = (path, fallback = null) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; } };

const [out, ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const examples = [...json(join(lold, "examples.json")).examples, ...json(join(lold, "examples.hand.json")).examples].filter(e => !only.length || only.includes(e.id));

async function base(example, dir) {
  mkdirSync(dir, { recursive: true });
  if (example.kind === "repo") {
    for (const file of ["package.json", "package-lock.json"]) cpSync(join(repo, example.project, file), join(dir, file));
    return true;
  }
  const before = example.kind === "row" ? new Date(Date.parse((await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(example.name)}`)).json()).time[example.from]) + 3_600_000).toISOString() : example.base_before;
  write(dir, "package.json", `${JSON.stringify({ name: "lold-example", version: "1.0.0", private: true, dependencies: example.kind === "row" ? { [example.name]: example.from } : example.project_dependencies }, null, 2)}\n`);
  return npm(dir, ["install", "--package-lock-only", `--before=${before}`]).status === 0;
}

async function one(example) {
  const dir = join(out, "work", example.id), baseDir = join(dir, "base"), result = join(dir, "result"), scratch = join(dir, "scratch");
  rmSync(dir, { recursive: true, force: true });
  const row = { id: example.id, package: `${example.name} ${example.from} -> ${example.v}`, lold_outcome: json(join(lold, "results", `${example.id}.json`))?.outcome ?? null };
  if (!await base(example, baseDir)) return { ...row, outcome: "no_base" };
  const t = json(join(lold, "results", `${example.id}.json`))?.t;
  row.t = t;
  const manifest = json(join(baseDir, "package.json")), baseLock = readFileSync(join(baseDir, "package-lock.json"), "utf8");
  const direct = manifest.dependencies?.[example.name] !== undefined;
  const pinned = structuredClone(manifest), final = structuredClone(manifest);
  if (direct) { pinned.dependencies[example.name] = example.v; final.dependencies[example.name] = example.v; }
  else pinned.overrides = { [`${example.name}@${example.from}`]: example.v };
  const plan = [{ name: example.name, from: example.from, to: example.v, advisories: [example.advisory ?? "LOLD-T"] }];
  const started = Date.now();
  let table;
  try {
    table = await resolveOldest({ plan, baseLock, finalManifest: `${JSON.stringify(final, null, 2)}\n`, findings: [{ advisory: { id: plan[0].advisories[0], published: t } }] });
  } catch (error) { return { ...row, outcome: "failed", failure: `table: ${String(error.message).slice(0, 500)}`, seconds: (Date.now() - started) / 1000 }; }
  row.table_seconds = (Date.now() - started) / 1000;
  row.table_requirements = Object.keys(table.answers).length;
  row.table_without_answer = Object.values(table.answers).filter(a => !a.version).map(a => ({ requirement: a.requirement, reason: a.reason, excluded: a.excluded }));
  const tool = join(dir, "resolve");
  write(tool, "install.cjs", resolverScript(FLAGS).replace("/usr/local/lib/node_modules/npm/", NPM_DIR));
  write(tool, "table.json", tableFile(table));
  mkdirSync(result, { recursive: true });
  cpSync(join(baseDir, "package-lock.json"), join(result, "package-lock.json"));
  for (const [step, text] of [["pinned", pinned], ["final", final]]) {
    write(result, "package.json", `${JSON.stringify(text, null, 2)}\n`);
    const r = spawnSync(process.execPath, [join(tool, "install.cjs")], { cwd: result, encoding: "utf8", timeout: LIMIT, maxBuffer: 256 * 1024 * 1024, env });
    if (r.status !== 0) {
      const key = noAnswerIn(`${r.stderr}`);
      if (!key) return { ...row, outcome: "failed", failure: `npm, step ${step}: ${tail(r.stderr ?? "")}` };
      const { reason, stopped_no_allowed } = noAnswerReason(table, key);
      return { ...row, outcome: stopped_no_allowed ? "stopped_no_allowed" : "not_in_table", no_answer: key, reason };
    }
  }
  const afterLock = readFileSync(join(result, "package-lock.json"), "utf8");
  const was = new Map(lockEntries(baseLock).map(e => [e.path, e.version]));
  const moved = lockEntries(afterLock).filter(e => was.get(e.path) !== e.version && !(e.name === example.name && e.version === example.v)).map(e => ({ path: e.path, name: e.name, from: was.get(e.path) ?? null, to: e.version }));
  const gone = [...was.keys()].filter(path => !lockEntries(afterLock).some(e => e.path === path));
  row.moved_non_v = moved.length; row.path_moved = moved.filter(m => m.from).length; row.path_added = moved.filter(m => !m.from).length; row.path_removed = gone.length;
  row.unneeded_moves = unneededMoves(baseLock, afterLock, plan);
  row.new_unmet = newUnmetRequirements({ lock: baseLock, manifest }, { lock: afterLock, manifest: final });
  // npm's own view of the result, as LOLD's I5 and I6.
  rmSync(scratch, { recursive: true, force: true }); mkdirSync(scratch);
  for (const file of ["package.json", "package-lock.json"]) cpSync(join(result, file), join(scratch, file));
  row.npm_ci_dry_run = npm(scratch, ["ci", "--dry-run"]).status;
  const ls = npm(scratch, ["ls", "--all", "--package-lock-only", "--json"]);
  row.npm_ls_problems = (() => { try { return JSON.parse(ls.stdout).problems?.length ?? 0; } catch { return `unreadable, exit ${ls.status}`; } })();
  const lockBytes = readFileSync(join(scratch, "package-lock.json"));
  row.npm_install_again = npm(scratch, ["install", "--package-lock-only"]).status;
  row.lock_unchanged = lockBytes.equals(readFileSync(join(scratch, "package-lock.json")));
  // The judge and the asserts, as `ludion patch` calls them.
  try {
    const judgement = await judgeNpmCandidate(baseDir, result);
    row.judge = judgement.verdict; row.refusal = candidateRefusal(judgement)?.slice(0, 600) ?? null;
    const published = new Map();
    for (const c of judgement.changes) published.set(`${c.name}@${c.to}`, await table.publishedAt(c.name, c.to));
    const assert = resolutionAssert({ table, changes: judgement.changes, waitHours: judgement.wait_hours, pushedAt: new Date(), published: (name, version) => published.get(`${name}@${version}`) });
    row.assert = { t: assert.t, resolved_at: assert.resolved_at, wait_hours: assert.wait_hours, youngest: assert.youngest, wait_until: assert.wait_until, t_before_push_less_wait: assert.t_before_push_less_wait, waits: assert.waits, problems: assert.problems, versions: assert.versions };
    // What the PR job reads: this lockfile against the table it works out itself, with OSV's advisories and their times.
    row.not_oldest = notOldest(table, baseLock, afterLock, `${JSON.stringify(final, null, 2)}\n`);
    row.pr_job_recheck = await recheckOldest({ plan, beforeLock: baseLock, afterLock, finalManifest: `${JSON.stringify(final, null, 2)}\n` });
    const passes = !row.unneeded_moves.length && !row.new_unmet.length && !assert.problems.length && !row.not_oldest.length;
    row.outcome = passes ? "built" : "failed";
  } catch (error) { row.outcome = "failed"; row.failure = `judge: ${String(error.message).slice(0, 500)}`; }
  row.resolution_answers = fixResolution(table, row.assert?.versions?.map(v => ({ name: v.name, to: v.version })) ?? []).answers.map(a => ({ requirement: a.requirement, version: a.version, role: a.role, published_at: a.published_at, excluded: a.excluded }));
  return row;
}

const rows = [];
for (const example of examples) {
  const row = await one(example).catch(error => ({ id: example.id, outcome: "failed", failure: String(error?.stack ?? error).slice(0, 800) }));
  rows.push(row);
  write(join(out, "results"), `${example.id}.json`, `${JSON.stringify(row, null, 2)}\n`);
  console.log(JSON.stringify({ id: row.id, outcome: row.outcome, lold: row.lold_outcome, moved: row.moved_non_v, path_moved: row.path_moved, requirements: row.table_requirements, seconds: row.table_seconds, judge: row.judge, no_answer: row.no_answer, unneeded: row.unneeded_moves?.length, assert_problems: row.assert?.problems?.length, failure: row.failure?.slice(0, 200) }));
}
