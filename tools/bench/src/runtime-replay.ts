// Verify saved source/identity before touching Docker. Stored metadata is provenance, not model authentication.
import { readArtifact, taskHash, validateArtifact, type BenchArtifact } from "./bench-artifacts.ts";
import { gradeRuntime, RUNTIME_TASKS, type RuntimeGrade } from "./runtime-tasks.ts";
import type { ProjectFiles } from "./project-snapshot.ts";
import type { RunFn } from "../../verify/src/docker.ts";

export function validateReplay(artifact: BenchArtifact, task: { id: string }, expectedBase: ProjectFiles): void {
  validateArtifact(artifact);
  if (artifact.task_id !== task.id || artifact.task_sha256 !== taskHash(task)) throw new Error("Artifact task definition differs; it was not scored.");
  const normalized = (text: string | undefined) => text?.replace(/\r\n/g, "\n");
  for (const [path, text] of Object.entries(expectedBase)) {
    if (normalized(artifact.base_files[path]) !== normalized(text)) throw new Error(`Artifact baseline differs at ${path}; it was not scored.`);
  }
}

export async function gradeArtifact(artifact: BenchArtifact, task: { id: string }, expectedBase: ProjectFiles, run?: RunFn): Promise<RuntimeGrade> {
  if (!RUNTIME_TASKS.includes(artifact.task_id as typeof RUNTIME_TASKS[number])) return { verdict: "unsupported", why: "No runtime acceptance is defined; artifact was not scored." };
  try { validateReplay(artifact, task, expectedBase); }
  catch (err) { return { verdict: "error", why: (err as Error).message }; }
  const immutable = Object.fromEntries(Object.entries(artifact.base_files).filter(([path]) => artifact.task_id.endsWith("13-c") ? path.startsWith("src/") : path !== "src/convert.test.js"));
  return gradeRuntime(artifact.task_id, artifact.candidate_files, immutable, run);
}

export const loadReplay = (path: string, expectedSha256: string) => readArtifact(path, expectedSha256);
