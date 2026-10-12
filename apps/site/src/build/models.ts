// FreshBench per-model verdicts (docs/bench/models.json): which measured models already know each lesson's change.
// The shards carry them so sync can prune; /models shows them. Nothing here is estimated: a lesson without a
// measurement has no entry.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Verdict = "knows" | "misses";

export interface Models {
  /** When and how the verdicts were measured, and where the run's files are. */
  measured_at: string;
  bench: string;
  method: string;
  /** Model id (as sync's --model takes it) → its display name. */
  models: Record<string, { name: string }>;
  /** Lesson id → model id → verdict. */
  lessons: Record<string, Record<string, Verdict>>;
}

export function readModels(root: string): Models | null {
  const path = join(root, "docs", "bench", "models.json");
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Models) : null;
}

/** Per model, over the lessons that are measured and still active: how many it knows and misses. */
export function modelTotals(models: Models, active: Set<string>): { id: string; name: string; knows: number; misses: number }[] {
  return Object.entries(models.models).map(([id, { name }]) => {
    let knows = 0;
    let misses = 0;
    for (const [lesson, verdicts] of Object.entries(models.lessons)) {
      if (!active.has(lesson)) continue;
      if (verdicts[id] === "knows") knows++;
      else if (verdicts[id] === "misses") misses++;
    }
    return { id, name, knows, misses };
  });
}
