// Explicit runtime grading only. Never invokes a model or rewrites historical scores.
// --self-check --out file | --task id --project complete-project-folder --out file
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { pullImages } from "../../verify/src/docker.ts";
import { loadRuleTasks, gradeRules } from "./rule-tasks.ts";
import { gradeRuntime, snapshotProject, RUNTIME_TASKS, type ProjectFiles } from "./runtime-tasks.ts";

const tasks = loadRuleTasks(fileURLToPath(new URL("../tasks-c/", import.meta.url)));
function fixture(id: string) {
  const task = tasks.find((t) => t.id === id)!;
  const overlay = snapshotProject(task.overlay);
  const baseline = { ...snapshotProject(fileURLToPath(new URL("../projects/vitest/", import.meta.url))), ...overlay };
  const immutable = Object.fromEntries(Object.entries(baseline).filter(([p]) => id.endsWith("13-c") ? p.startsWith("src/") : p !== "src/convert.test.js"));
  return { task, baseline, immutable };
}

async function main() {
  const { values } = parseArgs({ options: { "self-check": { type: "boolean" }, task: { type: "string" }, project: { type: "string" }, out: { type: "string" } } });
  if (!values.out || (!values["self-check"] && (!values.task || !values.project))) throw new Error("Use --self-check --out file, or --task id --project complete-project-folder --out file.");
  if (values["self-check"] && (values.task || values.project)) throw new Error("Choose either fixture self-check or an actual complete project.");
  mkdirSync(dirname(values.out), { recursive: true });
  const rows: Record<string, unknown>[] = [];
  const save = () => writeFileSync(values.out!, JSON.stringify({ checked_at: new Date().toISOString(), runtime: "node@24", packages: { vitest: "5.0.3", vite: "7.3.1" }, kind: values["self-check"] ? "evaluator fixture validation, not model accuracy" : "runtime project acceptance", rows }, null, 2) + "\n");
  if (!values["self-check"] && !RUNTIME_TASKS.includes(values.task as typeof RUNTIME_TASKS[number])) {
    rows.push({ id: values.task, verdict: "unsupported", why: "No acceptance defined; not scored." }); save(); return;
  }
  const errors = pullImages(["node@24"]);
  if (errors.length) { rows.push({ verdict: "error", why: errors.join("\n") }); save(); process.exitCode = 1; return; }
  const evaluate = async (id: string, name: string, files: ProjectFiles, expected?: string) => {
    const { task, immutable } = fixture(id);
    const staticGrade = gradeRules(task, (p) => files[p]);
    const grade = await gradeRuntime(id, files, immutable);
    rows.push({ id, name, ...(expected ? { expected } : {}), static_verdict: staticGrade.verdict, ...grade }); save();
    console.log(`${id} ${name}: static=${staticGrade.verdict}, runtime=${grade.verdict}`);
    if ((expected && grade.verdict !== expected) || grade.verdict === "error" || (!expected && grade.verdict !== "passed")) process.exitCode = 1;
  };
  if (!values["self-check"]) { await evaluate(values.task!, "candidate project", snapshotProject(values.project!)); return; }
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
