// FreshBench per-model verdicts (docs/bench/models.json): which measured models already know each lesson's change.
// The shards carry them so sync can prune; /bench shows them (build/bench.ts). Nothing here is estimated: a lesson without a
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
