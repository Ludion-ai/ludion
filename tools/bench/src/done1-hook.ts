// Done 1 through the Claude Code plugin: project B has never been synced; the plugin's SessionStart hook runs
// `ludion sync --quiet` and its output reaches the session. The plugin is a local copy of plugin/ whose hook runs a
// given cli.js instead of `npx ludion@<version>` (not published yet). Usage:
//   node tools/bench/src/done1-hook.ts <projects cache> <ludion cli.js> <ludion home> <out dir> [--trials 3] [--model opus]
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { claudeArgs, parseStream, runEnv } from "./agent.ts";
import { vitestExtendsTask, type Grade } from "./tasks.ts";

function localPlugin(cli: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ludion-plugin-"));
  mkdirSync(join(dir, ".claude-plugin"));
  mkdirSync(join(dir, "hooks"));
  writeFileSync(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "ludion-local", version: "0.0.0" }));
  const command = `node "${resolve(cli).replace(/\\/g, "/")}" sync --quiet --offline --dir "\${CLAUDE_PROJECT_DIR}"`;
  writeFileSync(join(dir, "hooks", "hooks.json"), JSON.stringify({ hooks: { SessionStart: [{ matcher: "startup|resume|clear", hooks: [{ type: "command", command, timeout: 120 }] }] } }));
  return dir;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { trials: { type: "string", default: "3" }, model: { type: "string", default: "opus" } } });
  const [cache, cli, home, out] = positionals;
  if (!cache || !cli || !home || !out) {
    console.error("Usage: node tools/bench/src/done1-hook.ts <projects cache> <ludion cli.js> <ludion home> <out dir> [--trials 3] [--model opus]");
    process.exit(2);
  }
  const task = vitestExtendsTask(cache);
  const plugin = localPlugin(cli);
  mkdirSync(join(out, "runs"), { recursive: true });
  const rows: Array<Grade & { condition: "hook"; trial: number; hookSeen: boolean; answer: string; toolCalls: string[]; costUsd: number; turns: number; isError: boolean }> = [];
  for (let trial = 1; trial <= Number(values.trials); trial++) {
    const work = join(mkdtempSync(join(tmpdir(), "ludion-hook-")), "work");
    cpSync(task.project, work, { recursive: true });
    cpSync(task.overlay, work, { recursive: true });
    const args = [...claudeArgs(task.prompt, { condition: "project", model: values.model!, maxTurns: 25, maxBudgetUsd: 2, allowEdits: true }), "--plugin-dir", plugin];
    const log = await new Promise<string[]>((done, fail) => {
      const child = spawn("claude", args, { cwd: work, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...runEnv(), LUDION_HOME: home } });
      const timer = setTimeout(() => child.kill(), 15 * 60_000);
      let stdout = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.on("error", fail);
      child.on("close", () => (clearTimeout(timer), done(stdout.split(/\r?\n/).filter(Boolean))));
    });
    const run = parseStream(log);
    const grade = task.grade(work);
    // Did the hook's output reach the session? The init/hook messages carry it in stream-json.
    const hookSeen = log.some((l) => l.includes("after this session read CLAUDE.md"));
    writeFileSync(join(out, "runs", `hook-${trial}.jsonl`), log.join("\n") + "\n");
    writeFileSync(join(out, "runs", `hook-${trial}.vitest.config.ts`), readFileSync(join(work, "vitest.config.ts"), "utf8"));
    rows.push({ condition: "hook", trial, ...grade, hookSeen, answer: run.answer, toolCalls: run.toolCalls, costUsd: run.costUsd, turns: run.turns, isError: run.isError });
    console.log(`hook-${trial}: ${grade.verdict} (${grade.why}) hook output in log: ${hookSeen} $${run.costUsd.toFixed(2)}`);
  }
  const correct = rows.filter((r) => r.verdict === "correct").length;
  writeFileSync(join(out, "summary-hook.json"), JSON.stringify({ task: task.id, model: values.model, correct: `${correct}/${rows.length}`, spentUsd: rows.reduce((s, r) => s + r.costUsd, 0), rows }, null, 2) + "\n");
  console.log(`hook: ${correct}/${rows.length} correct`);
}

if (import.meta.main) await main();
