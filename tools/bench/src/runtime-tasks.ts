// Optional execution acceptance for selected C tasks. Historical regex grades and model runs stay unchanged.
// Candidate content is only read on the host; it executes solely through the network-off Docker runner.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { runInDocker, type RunFn, type RunSpec } from "../../verify/src/docker.ts";

export const RUNTIME_TASKS = ["vitest-5-0-0-13-c", "vitest-5-0-0-16-c"] as const;
export type RuntimeTaskId = typeof RUNTIME_TASKS[number];
export type ProjectFiles = Record<string, string>;
export interface RuntimeGrade {
  verdict: "passed" | "failed" | "unsupported" | "error";
  why: string;
  observations?: unknown;
}
const MAX_FILES = 64;
const MAX_BYTES = 512 * 1024;
const excluded = new Set(["node_modules", ".git", ".claude", ".ludion", ".cursor", "package-lock.json"]);
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".json", ".jsonc"]);

export function checkedFiles(files: ProjectFiles): ProjectFiles {
  let bytes = 0;
  if (Object.keys(files).length > MAX_FILES) throw new Error("Too many candidate files.");
  for (const [path, text] of Object.entries(files)) {
    if (!/^[A-Za-z0-9_.@/-]{1,240}$/.test(path) || path.split("/").some((p) => !p || p === "." || p === ".." || excluded.has(p)) || typeof text !== "string") throw new Error("Invalid candidate path or text.");
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_BYTES) throw new Error("Candidate files are too large.");
  }
  return files;
}

/** A complete source snapshot, not a regex-only 'left' record. Dependencies come from the trusted harness. */
export function snapshotProject(dir: string): ProjectFiles {
  const files: ProjectFiles = Object.create(null);
  let visited = 0;
  const visit = (rel: string) => {
    if (++visited > 256 || rel.split("/").length > 16) throw new Error("Candidate source tree is too large or too deep.");
    const path = join(dir, rel);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error("Candidate snapshots must not contain symbolic links.");
    if (st.isDirectory()) {
      for (const name of readdirSync(path)) if (!excluded.has(name)) visit(rel ? `${rel}/${name}` : name);
    } else if (st.isFile() && sourceExtensions.has(extname(path))) {
      if (st.size > MAX_BYTES) throw new Error("Candidate file is too large.");
      files[rel] = readFileSync(path, "utf8");
      checkedFiles(files);
    }
  };
  visit("");
  return checkedFiles(files);
}

export function runtimeSpec(id: RuntimeTaskId, files: ProjectFiles, immutable: ProjectFiles): RunSpec {
  checkedFiles(files);
  checkedFiles(immutable);
  const probe = readFileSync(new URL("../runtime/acceptance.cjs", import.meta.url), "utf8");
  return {
    runtime: "node@24",
    packages: { vitest: "5.0.3", vite: "7.3.1" },
    code: `const input = ${JSON.stringify({ id, files, immutable })};\n${probe}`,
  };
}

export async function gradeRuntime(id: string, files: ProjectFiles, immutable: ProjectFiles, run: RunFn = runInDocker): Promise<RuntimeGrade> {
  if (!RUNTIME_TASKS.includes(id as RuntimeTaskId)) return { verdict: "unsupported", why: "No runtime acceptance is defined for this task; it was not scored." };
  let spec: RunSpec;
  try { spec = runtimeSpec(id as RuntimeTaskId, files, immutable); }
  catch (err) { return { verdict: "error", why: (err as Error).message }; }
  const result = await run(spec);
  if (result.kind === "error") return { verdict: "error", why: result.reason };
  if (result.timedOut || result.exitCode === null) return { verdict: "error", why: "Sandbox execution did not finish; it was not scored." };
  if (result.exitCode === 2) return { verdict: "error", why: "Sandbox subprocess could not finish; it was not scored." };
  if (result.exitCode !== 0) return { verdict: "failed", why: (result.stderr || result.stdout).trim().slice(-2000) || "Runtime acceptance failed." };
  const line = result.stdout.split("\n").find((line) => line.startsWith("LUDION_ACCEPTANCE="));
  try {
    const observations = JSON.parse(line?.slice("LUDION_ACCEPTANCE=".length) ?? "");
    if (observations?.id !== id || observations?.passed !== true) throw new Error("Invalid acceptance result.");
    return { verdict: "passed", why: "Pinned-package execution and task acceptance checks passed.", observations };
  } catch { return { verdict: "error", why: "Sandbox did not return a valid acceptance result; it was not scored." }; }
}
