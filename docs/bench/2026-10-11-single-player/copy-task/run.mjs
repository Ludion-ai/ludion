// Done 1 (single player): Claude Code in project B, before and after `ludion sync`, on a task that depends on a
// silent vitest 5 change (the junit reporter's default output file). Usage: node run-done1.mjs <trials> <out dir>
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [trialsArg, out] = process.argv.slice(2);
const trials = Number(trialsArg ?? 3);
const base = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const template = join(base, "projectB-template");
const home = join(base, "home");
// The bundled CLI, copied out of the repo, so branch switches in the checkout can't change it mid-run.
const cli = join(base, "ludion.js");

const TASK =
  "Add an npm script named test:report to package.json that runs the Vitest suite with the junit reporter and then copies the JUnit XML report to reports/junit.xml, so our CI can pick it up from there. Keep Vitest's default report location: don't configure an output file. The script must work on Linux. When you're done, say which file it copies.";

/** Correct when test:report copies .vitest/junit/output.xml and no output file was configured. */
export function grade(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const script = pkg.scripts?.["test:report"];
  if (!script) return { correct: false, why: "no test:report script" };
  const cfg = ["vitest.config.ts", "vitest.config.js", "vite.config.ts", "vite.config.js"].map((f) => join(dir, f)).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
  const helper = /node\s+(\S+\.(?:m?js|cjs))/.exec(script)?.[1];
  const helperText = helper && existsSync(join(dir, helper)) ? readFileSync(join(dir, helper), "utf8") : "";
  if (/outputFile/i.test(script + cfg + helperText)) return { correct: false, why: `configured an output file: ${script}` };
  return /\.vitest\/junit\/output\.xml/.test(script + helperText) ? { correct: true, why: script } : { correct: false, why: script };
}
function claude(dir, log) {
  const args = [
    "-p", TASK,
    "--output-format", "stream-json", "--verbose",
    "--model", "opus",
    "--max-turns", "25",
    "--max-budget-usd", "2",
    "--no-session-persistence",
    "--setting-sources", "project",
    "--strict-mcp-config",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Bash(npx:*),Bash(npm:*),Bash(node:*),Bash(ls:*),Bash(cat:*),Bash(find:*),Bash(git:*),Read,Write,Edit,Glob,Grep,WebSearch,WebFetch",
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));
    const timer = setTimeout(() => child.kill(), 15 * 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      writeFileSync(log, stdout);
      const result = stdout.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } }).find((m) => m.type === "result") ?? {};
      const tools = stdout.split(/\r?\n/).filter(Boolean).flatMap((l) => { try { const m = JSON.parse(l); return m.type === "assistant" ? (m.message?.content ?? []).filter((c) => c.type === "tool_use").map((c) => c.name + (c.name === "Bash" ? `(${String(c.input?.command ?? "").slice(0, 60)})` : "")) : []; } catch { return []; } });
      resolve({ cost: Number(result.total_cost_usd ?? 0), turns: result.num_turns ?? 0, answer: String(result.result ?? "").slice(-400), tools });
    });
  });
}

if (process.argv[1]?.endsWith("run-done1b.mjs")) {
  mkdirSync(out, { recursive: true });
  const rows = [];
  for (const condition of ["before", "after"]) {
    for (let i = 1; i <= trials; i++) {
      const dir = mkdtempSync(join(tmpdir(), `ludion-done1-${condition}-`));
      cpSync(template, dir, { recursive: true });
      if (condition === "after") {
        const r = spawnSync(process.execPath, [cli, "sync", "--dir", dir, "--offline"], { encoding: "utf8", env: { ...process.env, LUDION_HOME: home } });
        process.stdout.write(r.stdout + r.stderr);
      }
      const run = await claude(dir, join(out, `${condition}-${i}.jsonl`));
      const g = grade(dir);
      cpSync(join(dir, "package.json"), join(out, `${condition}-${i}-package.json`));
      rows.push({ condition, trial: i, ...g, cost: run.cost, turns: run.turns, tools: run.tools });
      process.stdout.write(`${condition} ${i}: ${g.correct ? "CORRECT" : "wrong"} (${g.why}) $${run.cost.toFixed(2)} tools=${run.tools.length}\n`);
    }
  }
  writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 2) + "\n");
  const rate = (c) => `${rows.filter((r) => r.condition === c && r.correct).length}/${rows.filter((r) => r.condition === c).length}`;
  console.log(`before: ${rate("before")} correct, after: ${rate("after")} correct, spent $${rows.reduce((s, r) => s + r.cost, 0).toFixed(2)}`);
}
