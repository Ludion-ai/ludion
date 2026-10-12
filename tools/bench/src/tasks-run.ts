// Runs the C tasks (tools/bench/tasks-c) under the realistic condition: Claude Code with edits and no shell in a copy of
// the prepared project plus the task's files, with or without `ludion sync` first. Usage:
//   node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> --run-model [--trials 1] [--model opus] [--only id,id]
//     [--sync <ludion cli.js> [--site <url>] [--ludion-home <dir>] [--offline]] [--cap-usd 40]
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runAgent } from "./agent.ts";
import { gradeRules, loadRuleTasks, readFrom } from "./rule-tasks.ts";
import { artifactDir, boundedText, ensureArtifactDir, hashText, makeArtifact, saveArtifact, taskHash } from "./bench-artifacts.ts";
import { snapshotProject, type ProjectFiles } from "./project-snapshot.ts";
import { nextRunBudget, reportedCost, runBounds } from "./task-run-input.ts";
import { preparedInputsHash } from "./prepared-inputs.ts";
import { readState, saveState, spentOn, withMeasurementLock, type Attempt } from "./measurement-state.ts";
import { randomUUID } from "node:crypto";

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
      "run-model": { type: "boolean" },
      "artifact-dir": { type: "string" },
    },
  });
  const [cache, out, label] = positionals;
  if (!cache || !out || !label) {
    console.error("Usage: node tools/bench/src/tasks-run.ts <projects cache> <out dir> <label> --run-model [--trials 1] [--model opus] [--only id,id] [--sync <cli.js> [--site <url>] [--ludion-home <dir>] [--offline]] [--cap-usd 40] [--artifact-dir private-folder]");
    process.exit(2);
  }
  const { trials, cap } = runBounds(label, values.trials!, values["cap-usd"]!, values["run-model"] === true);
  const site = values.sync ? values.site ?? process.env.LUDION_SITE ?? "https://ludion.ai" : null;
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const harnessSha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["-c", "core.fsmonitor=false", "-C", repo, "status", "--porcelain", "--", "tools/bench", "tools/verify/src", "packages/core/src", ".node-version", "package.json", "package-lock.json"], { encoding: "utf8" });
  if (dirty.trim()) throw new Error("Commit the measurement harness before starting a model run.");
  if (values.offline && !values.sync) throw new Error("--offline requires --sync.");
  const cliHash = values.sync ? hashText(boundedText(values.sync)) : null;
  const only = values.only?.split(",");
  const tasks = loadRuleTasks(TASKS).filter((t) => !only || only.includes(t.id));
  const inputsHash = preparedInputsHash(cache, loadRuleTasks(TASKS).map((t) => t.library));
  const identity = { label, model: values.model!, sync: Boolean(values.sync), site, offline: values.offline === true, sync_cli_sha256: cliHash, harness_sha: harnessSha, inputs_sha256: inputsHash };
  mkdirSync(join(out, "runs", label), { recursive: true });
  const env = { ...process.env, ...(values.site ? { LUDION_SITE: values.site } : {}), ...(values["ludion-home"] ? { LUDION_HOME: values["ludion-home"] } : {}) };
  // Saved after every run and resumed from: a batch can run over several days (the plan's session limit stops it),
  // and the same command picks up where the last one stopped.
  const summaryPath = join(out, `tasks-${label}.json`);
  await withMeasurementLock(summaryPath, async () => {
    const resumed = existsSync(summaryPath) ? readState(summaryPath, identity) : { rows: [] as Record<string, unknown>[], attempts: [] as Attempt[], spent: 0 };
    const { rows, attempts } = resumed;
    const artifacts = values["artifact-dir"] ?? artifactDir();
    ensureArtifactDir(artifacts);
    const done = new Set(rows.map((r) => `${r.id}#${r.trial}`));
    let spent = resumed.spent;
    // Only trials up to --trials count, so rows kept from a run with more trials don't weigh some tasks more.
    const counted = () => rows.filter((r) => Number(r.trial) <= trials);
    const save = () => {
      const correct = counted().filter((r) => r.verdict === "correct").length;
      saveState(summaryPath, { format: 2, ...identity, trials, correct, runs: counted().length, spentUsd: spent, rows, attempts });
      return correct;
    };
    let stopped = "";
    for (const task of tasks) {
      if (stopped) break;
      for (let trial = 1; trial <= trials; trial++) {
        if (done.has(`${task.id}#${trial}`)) continue;
        const budget = nextRunBudget(cap, spent);
        if (!budget) break;
        let work = "";
        let baseFiles: ProjectFiles = {};
        let delivery: string | null = null;
        const attemptId = randomUUID();
        const run = await runAgent(task.prompt, {
          condition: "project",
          model: values.model!,
          maxTurns: 25,
          maxBudgetUsd: budget,
          timeoutMs: 15 * 60_000,
          project: join(cache, task.library),
          allowEdits: true,
          prepare: (dir) => {
            work = dir;
            if (existsSync(task.overlay)) cpSync(task.overlay, dir, { recursive: true });
            if (values.sync) {
              const r = spawnSync(process.execPath, [values.sync, "sync", "--dir", dir, "--model", values.model!, ...(values.offline ? ["--offline"] : [])], { encoding: "utf8", env });
              if (r.status !== 0) throw new Error(`ludion sync failed: ${r.stderr}`);
              delivery = boundedText(join(dir, ".ludion/lessons.md"), 512 * 1024);
            }
            baseFiles = snapshotProject(dir);
            makeArtifact({ task_id: task.id, task_sha256: taskHash(task), trial, model: values.model!, sync: Boolean(values.sync), site, offline: identity.offline, sync_cli_sha256: cliHash, harness_sha: harnessSha, inputs_sha256: inputsHash, base_files: baseFiles, candidate_files: baseFiles }, delivery);
            if (preparedInputsHash(cache, loadRuleTasks(TASKS).map((t) => t.library)) !== inputsHash) throw new Error("Prepared benchmark inputs changed; no model run started.");
            attempts.push({ id: attemptId, task_id: task.id, trial, status: "pending", costUsd: null });
            save(); // Durable before runAgent starts the model process.
          },
        });
        const cost = reportedCost(run.log);
        const attempt = attempts.find((a) => a.id === attemptId);
        if (!attempt) throw new Error("Model returned without a durable attempt ledger.");
        if (cost === undefined || cost !== run.costUsd) {
          attempt.status = "unknown";
          save();
          writeFileSync(join(out, "runs", label, `${task.id}-${trial}.unscored.jsonl`), run.log.join("\n") + "\n");
          stopped = `${task.id}-${trial}: reported cost is unknown; no further model runs`;
          break;
        }
        attempt.status = "complete";
        attempt.costUsd = cost;
        spent = spentOn(attempts);
        save(); // Includes charges from model errors, even when no grade is saved.
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
        let artifact;
        let artifactError: string | undefined;
        try {
          artifact = saveArtifact(makeArtifact({ task_id: task.id, task_sha256: taskHash(task), trial, model: values.model!, sync: Boolean(values.sync), site, offline: identity.offline, sync_cli_sha256: cliHash, harness_sha: harnessSha, inputs_sha256: inputsHash, base_files: baseFiles, candidate_files: snapshotProject(work) }, delivery), artifacts);
        } catch (err) { artifactError = (err as Error).message; stopped = `${task.id}-${trial}: source capture failed; no further model runs`; }
        rows.push({ id: task.id, change: task.change, trial, attempt_id: attemptId, ...grade, answer: run.answer, toolCalls: run.toolCalls, costUsd: run.costUsd, isError: run.isError, left, ...(artifact ? { artifact } : { artifact_error: artifactError }) });
        save();
        console.log(`${name}: ${grade.verdict} $${run.costUsd.toFixed(2)} (total $${spent.toFixed(2)})`);
      }
    }
    if (stopped) console.log(`stopped at ${stopped}\nModel-error runs are not graded. Source-capture failures are recorded; resolve the cause before continuing.`);
    console.log(`${label}: ${save()}/${counted().length} correct, spent $${spent.toFixed(2)}`);
  });
}

if (import.meta.main) {
  try { await main(); } catch (err) { console.error((err as Error).message); process.exitCode = 1; }
}
