// Runs the C tasks (tools/bench/tasks-c) under the realistic condition: Claude Code with edits and no shell in a copy of
// the prepared project plus the task's files, with or without `ludion sync` first. Usage:
//   node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> [--trials 3] [--model opus] [--only id,id]
//     [--sync <ludion cli.js> [--site <url>] [--ludion-home <dir>] [--offline]] [--cap-usd 40]
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
      trials: { type: "string", default: "3" },
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
    console.error("Usage: node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> [--trials 3] [--model opus] [--only id,id] [--sync <cli.js> [--site <url>] [--ludion-home <dir>] [--offline]] [--cap-usd 40]");
    process.exit(2);
  }
  const only = values.only?.split(",");
  const tasks = loadRuleTasks(TASKS).filter((t) => !only || only.includes(t.id));
  const cap = Number(values["cap-usd"]);
  mkdirSync(join(out, "runs", label), { recursive: true });
  const env = { ...process.env, ...(values.site ? { LUDION_SITE: values.site } : {}), ...(values["ludion-home"] ? { LUDION_HOME: values["ludion-home"] } : {}) };
  const rows = [];
  let spent = 0;
  for (const task of tasks) {
    for (let trial = 1; trial <= Number(values.trials); trial++) {
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
      const grade = gradeRules(task, readFrom(work));
      const name = `${task.id}-${trial}`;
      writeFileSync(join(out, "runs", label, `${name}.jsonl`), run.log.join("\n") + "\n");
      rows.push({ id: task.id, change: task.change, trial, ...grade, answer: run.answer, toolCalls: run.toolCalls, costUsd: run.costUsd, isError: run.isError, work });
      console.log(`${name}: ${grade.verdict} $${run.costUsd.toFixed(2)} (total $${spent.toFixed(2)})`);
    }
  }
  const correct = rows.filter((r) => r.verdict === "correct").length;
  writeFileSync(join(out, `tasks-${label}.json`), JSON.stringify({ label, model: values.model, sync: Boolean(values.sync), site: values.site ?? null, trials: Number(values.trials), correct, runs: rows.length, spentUsd: spent, rows }, null, 2) + "\n");
  console.log(`${label}: ${correct}/${rows.length} correct, spent $${spent.toFixed(2)}`);
}

if (import.meta.main) await main();
