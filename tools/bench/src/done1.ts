// Done 1 (single player): Claude Code with edits in project B, before and after `ludion sync` writes a lesson taught
// in project A (from the teacher's ledger). Usage:
//   node tools/bench/src/done1.ts <projects cache> <ludion cli.js> <ludion home> <out dir> [--trials 5] [--model opus]
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runAgent } from "./agent.ts";
import { vitestExtendsTask, type Grade, type Task } from "./tasks.ts";

type Condition = "before" | "after";

function prepare(task: Task, condition: Condition, cli: string, home: string) {
  return (work: string) => {
    cpSync(task.overlay, work, { recursive: true });
    if (condition === "before") return;
    const r = spawnSync(process.execPath, [cli, "sync", "--dir", work, "--offline"], { encoding: "utf8", env: { ...process.env, LUDION_HOME: home } });
    if (r.status !== 0) throw new Error(`ludion sync failed: ${r.stderr}`);
    process.stdout.write(r.stdout);
  };
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { trials: { type: "string", default: "5" }, model: { type: "string", default: "opus" } } });
  const [cache, cli, home, out] = positionals;
  if (!cache || !cli || !home || !out) {
    console.error("Usage: node tools/bench/src/done1.ts <projects cache> <ludion cli.js> <ludion home> <out dir> [--trials 5] [--model opus]");
    process.exit(2);
  }
  const task = vitestExtendsTask(cache);
  mkdirSync(join(out, "runs"), { recursive: true });
  const rows: Array<Grade & { condition: Condition; trial: number; answer: string; toolCalls: string[]; costUsd: number; turns: number; isError: boolean }> = [];
  for (const condition of ["before", "after"] as const) {
    for (let trial = 1; trial <= Number(values.trials); trial++) {
      let config = "";
      const run = await runAgent(task.prompt, {
        condition: "project",
        model: values.model!,
        maxTurns: 25,
        maxBudgetUsd: 2,
        timeoutMs: 15 * 60_000,
        project: task.project,
        allowEdits: true,
        prepare: (work) => {
          prepare(task, condition, cli, home)(work);
          // Grade inside the same folder after the run; remember where it is.
          config = work;
        },
      });
      const grade = task.grade(config);
      const name = `${condition}-${trial}`;
      writeFileSync(join(out, "runs", `${name}.jsonl`), run.log.join("\n") + "\n");
      writeFileSync(join(out, "runs", `${name}.vitest.config.ts`), readFileSync(join(config, "vitest.config.ts"), "utf8"));
      rows.push({ condition, trial, ...grade, answer: run.answer, toolCalls: run.toolCalls, costUsd: run.costUsd, turns: run.turns, isError: run.isError });
      console.log(`${name}: ${grade.verdict} (${grade.why}) $${run.costUsd.toFixed(2)} tools=${run.toolCalls.join(",") || "none"}`);
    }
  }
  const rate = (c: Condition) => `${rows.filter((r) => r.condition === c && r.verdict === "correct").length}/${rows.filter((r) => r.condition === c).length}`;
  const spent = rows.reduce((s, r) => s + r.costUsd, 0);
  writeFileSync(join(out, "summary.json"), JSON.stringify({ task: task.id, model: values.model, prompt: task.prompt, before: rate("before"), after: rate("after"), spentUsd: spent, rows }, null, 2) + "\n");
  console.log(`before: ${rate("before")} correct, after: ${rate("after")} correct, spent $${spent.toFixed(2)}`);
}

if (import.meta.main) await main();
