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
  "Add a GitHub Actions workflow at .github/workflows/ci.yml that installs dependencies with npm ci, runs the Vitest suite with the junit reporter, and uploads the JUnit XML report as a build artifact with actions/upload-artifact. Keep Vitest's default report location: don't configure an output file. When you're done, say which path the workflow uploads.";

/** Correct when the upload covers .vitest/junit/output.xml and no output file was configured. */
export function grade(dir) {
  const wf = join(dir, ".github", "workflows", "ci.yml");
  if (!existsSync(wf)) return { correct: false, why: "no ci.yml" };
  const text = readFileSync(wf, "utf8");
  const cfg = ["vitest.config.ts", "vitest.config.js", "vite.config.ts", "vite.config.js"].map((f) => join(dir, f)).filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
  if (/outputFile/i.test(text + cfg)) return { correct: false, why: "configured an output file" };
  const paths = [...text.matchAll(/^\s*path:\s*([\s\S]*?)(?=^\s*[a-z-]+:|^\s*-\s|\Z)/gim)].map((m) => m[1]).join(" ");
  const covers = /\.vitest\/junit\/output\.xml|\.vitest\/junit\/?(\s|$|\*)|\.vitest\/?(\s|$)|\.vitest\/\*\*/.test(paths);
  // .vitest is a hidden directory: actions/upload-artifact skips hidden files unless include-hidden-files is true.
  if (covers && !/include-hidden-files:\s*true/.test(text)) return { correct: false, why: `uploads ${paths.trim().split(/\s+/).join(" ")} without include-hidden-files: true (uploads nothing)` };
  return covers ? { correct: true, why: `uploads ${paths.trim().split(/\s+/).join(" ")}` } : { correct: false, why: `uploads ${paths.trim().split(/\s+/).join(" ") || "(no path)"}` };
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

if (process.argv[1]?.endsWith("run-done1.mjs")) {
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
      const wf = join(dir, ".github", "workflows", "ci.yml");
      if (existsSync(wf)) cpSync(wf, join(out, `${condition}-${i}-ci.yml`));
      rows.push({ condition, trial: i, ...g, cost: run.cost, turns: run.turns, tools: run.tools });
      process.stdout.write(`${condition} ${i}: ${g.correct ? "CORRECT" : "wrong"} (${g.why}) $${run.cost.toFixed(2)} tools=${run.tools.length}\n`);
    }
  }
  writeFileSync(join(out, "results.json"), JSON.stringify(rows, null, 2) + "\n");
  const rate = (c) => `${rows.filter((r) => r.condition === c && r.correct).length}/${rows.filter((r) => r.condition === c).length}`;
  console.log(`before: ${rate("before")} correct, after: ${rate("after")} correct, spent $${rows.reduce((s, r) => s + r.cost, 0).toFixed(2)}`);
}
