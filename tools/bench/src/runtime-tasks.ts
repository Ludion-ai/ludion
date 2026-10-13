// Optional execution acceptance for selected C tasks. Historical regex grades and model runs stay unchanged.
// Candidate content is only read on the host; it executes solely through the network-off Docker runner.
import { readFileSync } from "node:fs";
import { runInDocker, type RunFn, type RunSpec } from "../../verify/src/docker.ts";
import { checkoutArgs } from "./checkout-command.ts";
import { checkedFiles, type ProjectFiles } from "./project-snapshot.ts";
export { checkedFiles, snapshotProject, type ProjectFiles } from "./project-snapshot.ts";

export const RUNTIME_TASKS = ["vitest-5-0-0-13-c", "vitest-5-0-0-16-c"] as const;
export type RuntimeTaskId = typeof RUNTIME_TASKS[number];
export interface RuntimeGrade {
  verdict: "passed" | "failed" | "unsupported" | "error";
  why: string;
  observations?: unknown;
}

export function runtimeSpec(id: RuntimeTaskId, files: ProjectFiles, immutable: ProjectFiles): RunSpec {
  checkedFiles(files);
  checkedFiles(immutable);
  const probe = readFileSync(new URL("../runtime/acceptance.cjs", import.meta.url), "utf8");
  return {
    runtime: "node@24",
    packages: { vitest: "5.0.3", vite: "7.3.1" },
    code: `const input = ${JSON.stringify({ id, files, immutable })};\nconst checkoutArgs = ${checkoutArgs.toString()};\n${probe}`,
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
  if ([2, 125, 126, 127].includes(result.exitCode)) return { verdict: "error", why: "Sandbox harness could not start or finish; it was not scored." };
  if (result.exitCode !== 0) return { verdict: "failed", why: (result.stderr || result.stdout).trim().slice(-2000) || "Runtime acceptance failed." };
  const line = result.stdout.split("\n").find((line) => line.startsWith("LUDION_ACCEPTANCE="));
  try {
    const observations = JSON.parse(line?.slice("LUDION_ACCEPTANCE=".length) ?? "");
    if (observations?.id !== id || observations?.passed !== true) throw new Error("Invalid acceptance result.");
    return { verdict: "passed", why: "Pinned-package execution and task acceptance checks passed.", observations };
  } catch { return { verdict: "error", why: "Sandbox did not return a valid acceptance result; it was not scored." }; }
}
