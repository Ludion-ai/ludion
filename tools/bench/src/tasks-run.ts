// Runs the C tasks (tools/bench/tasks-c) under the realistic condition: Claude Code with edits and no shell in a copy of
// the prepared project plus the task's files, with or without `ludion sync` first. Usage:
//   node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> [--trials 1] [--model opus] [--only id,id]
//     [--sync <ludion cli.js> [--site <url>] [--ludion-home <dir>] [--offline]] [--cap-usd 40]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runAgent } from "./agent.ts";
import { gradeRules, loadRuleTasks, readFrom } from "./rule-tasks.ts";

const TASKS = fileURLToPath(new URL("../tasks-c/", import.meta.url));

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      trials: { type: "string", default: "1" },
      model: { type: "string", default: "opus" },
      only: { type: "string" },
      sync: { type: "string" },
      site: { type: "string" },
      "ludion-home": { type: "string" },
      offline: { type: "boolean" },
      "cap-usd": { type: "string", default: "40" },
    },
  });
  const [cache, out, label] = positionals;
  if (!cache || !out || !label) {
    console.error("Usage: node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> [--trials 1] [--model opus] [--only id,id] [--sync <cli.js> [--site <url>] [--ludion-home <dir>] [--offline]] [--cap-usd 40]");
    process.exit(2);
  }
  const only = values.only?.split(",");
  const tasks = loadRuleTasks(TASKS).filter((t) => !only || only.includes(t.id));
  const cap = Number(values["cap-usd"]);
  mkdirSync(join(out, "runs", label), { recursive: true });
  const env = { ...process.env, ...(values.site ? { LUDION_SITE: values.site } : {}), ...(values["ludion-home"] ? { LUDION_HOME: values["ludion-home"] } : {}) };
  // Saved after every run and resumed from: a batch can run over several days (the plan's session limit stops it),
  // and the same command picks up where the last one stopped.
  const trials = Number(values.trials);
  const summaryPath = join(out, `tasks-${label}.json`);
  const rows: Record<string, unknown>[] = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")).rows : [];
  const done = new Set(rows.map((r) => `${r.id}#${r.trial}`));
  let spent = rows.reduce((s, r) => s + Number(r.costUsd ?? 0), 0);
  // Only trials up to --trials count, so rows kept from a run with more trials don't weigh some tasks more.
  const counted = () => rows.filter((r) => Number(r.trial) <= trials);
  const save = () => {
    const correct = counted().filter((r) => r.verdict === "correct").length;
    writeFileSync(summaryPath, JSON.stringify({ label, model: values.model, sync: Boolean(values.sync), site: values.site ?? null, trials, correct, runs: counted().length, spentUsd: spent, rows }, null, 2) + "\n");
    return correct;
  };
  let stopped = "";
  for (const task of tasks) {
    if (stopped) break;
    for (let trial = 1; trial <= trials; trial++) {
      if (done.has(`${task.id}#${trial}`)) continue;
      if (spent >= cap) break;
      let work = "";
      const run = await runAgent(task.prompt, {
        condition: "project",
        model: values.model!,
        maxTurns: 25,
        maxBudgetUsd: 2,
        timeoutMs: 15 * 60_000,
        project: join(cache, task.library),
        allowEdits: true,
        prepare: (dir) => {
          work = dir;
          if (existsSync(task.overlay)) cpSync(task.overlay, dir, { recursive: true });
          if (!values.sync) return;
          const r = spawnSync(process.execPath, [values.sync, "sync", "--dir", dir, "--model", values.model!, ...(values.offline ? ["--offline"] : [])], { encoding: "utf8", env });
          if (r.status !== 0) throw new Error(`ludion sync failed: ${r.stderr}`);
        },
      });
      spent += run.costUsd;
      // A run that ended on its own turn or dollar limit is graded like any other. Any other error (the plan's session
      // limit, a crash) says nothing about the task: it isn't saved, and the batch stops, because the next runs would fail
      // the same way. Run the same command again later to go on.
      if (run.isError && !run.log.some((l) => /"subtype":"error_max_(turns|budget_usd)"/.test(l))) {
        stopped = `${task.id}-${trial}: ${run.answer.slice(0, 200)}`;
        break;
      }
      const grade = gradeRules(task, readFrom(work));
      const name = `${task.id}-${trial}`;
      writeFileSync(join(out, "runs", label, `${name}.jsonl`), run.log.join("\n") + "\n");
      // The files the rules read, as the agent left them, so every grade can be checked by hand.
      const read = readFrom(work);
      const left = Object.fromEntries([...new Set(task.correct.flat().flatMap((r) => r.files))].flatMap((p) => (read(p) === undefined ? [] : [[p, read(p)!]])));
      rows.push({ id: task.id, change: task.change, trial, ...grade, answer: run.answer, toolCalls: run.toolCalls, costUsd: run.costUsd, isError: run.isError, left });
      save();
      console.log(`${name}: ${grade.verdict} $${run.costUsd.toFixed(2)} (total $${spent.toFixed(2)})`);
    }
  }
  if (stopped) console.log(`stopped at ${stopped}\nNothing was saved for that run. Run the same command again later to go on.`);
  console.log(`${label}: ${save()}/${counted().length} correct, spent $${spent.toFixed(2)}`);
}

if (import.meta.main) await main();
