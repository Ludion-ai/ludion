import { execTool } from "../../verify/src/command.ts";
// Explicit runtime grading only. Never invokes a model or rewrites historical scores.
// --self-check --out file | --task id --project complete-project-folder --out file
// --artifact private-snapshot.json --sha256 hash-from-run-record --out file
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { pullImages } from "../../verify/src/docker.ts";
import { loadRuleTasks, gradeRules } from "./rule-tasks.ts";
import { gradeRuntime, snapshotProject, RUNTIME_TASKS, type ProjectFiles } from "./runtime-tasks.ts";
import { filesHash, makeArtifact, saveArtifact, taskHash } from "./bench-artifacts.ts";
import { gradeArtifact, loadReplay, validateReplay } from "./runtime-replay.ts";

const tasks = loadRuleTasks(fileURLToPath(new URL("../tasks-c/", import.meta.url)));
function fixture(id: string) {
  const task = tasks.find((t) => t.id === id)!;
  const overlay = snapshotProject(task.overlay);
  const baseline = { ...snapshotProject(fileURLToPath(new URL("../projects/vitest/", import.meta.url))), ...overlay };
  const immutable = Object.fromEntries(Object.entries(baseline).filter(([p]) => id.endsWith("13-c") ? p.startsWith("src/") : p !== "src/convert.test.js"));
  return { task, baseline, immutable };
}

async function main() {
  const { values } = parseArgs({ options: { "self-check": { type: "boolean" }, task: { type: "string" }, project: { type: "string" }, out: { type: "string" }, artifact: { type: "string" }, sha256: { type: "string" }, "artifact-dir": { type: "string" } } });
  const modes = Number(values["self-check"] === true) + Number(!!values.artifact) + Number(!!values.project);
  if (!values.out || modes !== 1 || (values.project && !values.task) || (values.artifact && (!values.sha256 || values.task)) || (!values.artifact && values.sha256) || (values["self-check"] && values.task)) throw new Error("Choose --self-check, --task id --project folder, or --artifact file --sha256 recorded-hash; supply --out file.");
  mkdirSync(dirname(values.out), { recursive: true });
  const rows: Record<string, unknown>[] = [];
  const save = () => writeFileSync(values.out!, JSON.stringify({ checked_at: new Date().toISOString(), runtime: "node@24", packages: { vitest: "5.0.3", vite: "7.3.1" }, kind: values["self-check"] ? "evaluator fixture validation, not model accuracy" : "runtime project acceptance", rows }, null, 2) + "\n");
  let replay;
  if (values.artifact) {
    try {
      replay = loadReplay(values.artifact, values.sha256!);
      if (RUNTIME_TASKS.includes(replay.task_id as typeof RUNTIME_TASKS[number])) {
        const { task, baseline } = fixture(replay.task_id);
        validateReplay(replay, task, baseline);
      }
    } catch (err) { rows.push({ verdict: "error", why: (err as Error).message }); save(); process.exitCode = 1; return; }
  }
  const id = replay?.task_id ?? values.task;
  if (!values["self-check"] && !RUNTIME_TASKS.includes(id as typeof RUNTIME_TASKS[number])) {
    rows.push({ id, verdict: "unsupported", why: "No acceptance defined; not scored." }); save(); return;
  }
  const errors = pullImages(["node@24"]);
  if (errors.length) { rows.push({ verdict: "error", why: errors.join("\n") }); save(); process.exitCode = 1; return; }
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const harnessSha = execTool("git", ["-C", repo, "rev-parse", "HEAD"], { cwd: repo }).trim();
  const fixtureArtifacts = values["self-check"] ? values["artifact-dir"] ?? mkdtempSync(join(tmpdir(), "ludion-fixture-artifacts-")) : undefined;
  const evaluate = async (id: string, name: string, files: ProjectFiles, expected?: string) => {
    const { task, baseline, immutable } = fixture(id);
    const staticGrade = gradeRules(task, (p) => files[p]);
    let artifact;
    let grade;
    if (fixtureArtifacts) {
      artifact = saveArtifact(makeArtifact({ task_id: id, task_sha256: taskHash(task), trial: 1, model: "fixture", sync: false, site: null, offline: false, sync_cli_sha256: null, harness_sha: harnessSha, inputs_sha256: filesHash(baseline), base_files: baseline, candidate_files: files }, null), fixtureArtifacts);
      const saved = loadReplay(join(fixtureArtifacts, `${artifact.id}.json`), artifact.sha256);
      grade = await gradeArtifact(saved, task, baseline);
    } else grade = await gradeRuntime(id, files, immutable);
    rows.push({ id, name, ...(expected ? { expected } : {}), ...(artifact ? { artifact } : {}), static_verdict: staticGrade.verdict, ...grade }); save();
    console.log(`${id} ${name}: static=${staticGrade.verdict}, runtime=${grade.verdict}`);
    if ((expected && grade.verdict !== expected) || grade.verdict === "error" || (!expected && grade.verdict !== "passed")) process.exitCode = 1;
  };
  if (replay) {
    const { task, baseline } = fixture(replay.task_id);
    const grade = await gradeArtifact(replay, task, baseline);
    rows.push({ id: replay.task_id, artifact_sha256: values.sha256, capture_harness_sha: replay.harness_sha, evaluation_harness_sha: harnessSha, inputs_sha256: replay.inputs_sha256, candidate_sha256: replay.candidate_sha256, task_sha256: replay.task_sha256, trial: replay.trial, model: replay.model, sync: replay.sync, site: replay.site, offline: replay.offline, sync_cli_sha256: replay.sync_cli_sha256, delivery_sha256: replay.delivery?.sha256 ?? null, ...grade }); save();
    if (grade.verdict !== "passed") process.exitCode = 1;
    return;
  }
  if (!values["self-check"]) {
    try { await evaluate(values.task!, "candidate project", snapshotProject(values.project!)); }
    catch (err) { rows.push({ id: values.task, verdict: "error", why: (err as Error).message }); save(); process.exitCode = 1; }
    return;
  }
  for (const id of RUNTIME_TASKS) {
    const { task, baseline } = fixture(id);
    for (const [kind, expected] of [["correct", "passed"], ["wrong", "failed"]] as const) {
      for (const [i, example] of task.examples[kind].entries()) await evaluate(id, `${kind} fixture ${i + 1}`, { ...baseline, ...example }, expected);
    }
    const correct = { ...baseline, ...task.examples.correct[0] };
    if (id.endsWith("13-c")) {
      const pkg = JSON.parse(correct["package.json"]!);
      pkg.scripts["test:checkout"] = pkg.scripts["test:checkout"].replace("cart > checkout", "cart > checkoutNEVER");
      await evaluate(id, "matching flags but zero executed tests", { ...correct, "package.json": JSON.stringify(pkg) }, "failed");
      pkg.scripts["test:checkout"] += '; node -e "process.exit(0)"';
      await evaluate(id, "extra shell command rejected before execution", { ...correct, "package.json": JSON.stringify(pkg) }, "failed");
    } else {
      const tests = correct["src/convert.test.js"]!;
      await evaluate(id, "skipped rejection test", { ...correct, "src/convert.test.js": tests.replace("test('rejects when the rates are unavailable'", "test.skip('rejects when the rates are unavailable'") }, "failed");
      await evaluate(id, "wrong expected error despite matching keywords", { ...correct, "src/convert.test.js": tests.replace(".rejects.toThrow('Exchange rates are unavailable')", ".rejects.toThrow('Wrong error: unavailable')") }, "failed");
      await evaluate(id, "unrelated passing assertion", { ...correct, "src/convert.test.js": tests.replace("await expect(convert(10, 'EUR')).rejects.toThrow('Exchange rates are unavailable');", "expect(true).toBe(true);") }, "failed");
      await evaluate(id, "generic rejection without checking the required message", { ...correct, "src/convert.test.js": tests.replace(".rejects.toThrow('Exchange rates are unavailable')", ".rejects.toThrow()") }, "failed");
    }
  }
}
if (import.meta.main) await main();
