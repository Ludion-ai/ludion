// Index shards: the active set split by subject. Only format 1 lessons, the ones sync can match to a project's
// versions. Each lesson carries `models` when FreshBench measured which models already know the change
// (docs/bench/models.json), so sync can leave out what the target model knows.
import { join } from "node:path";
import type { Index, IndexEntry } from "@ludion/core";
import type { LessonPage, Tombstone } from "./data.ts";
import { readModels } from "./models.ts";

export type ModelVerdicts = Record<string, Record<string, "knows" | "misses">>;

/** Known inactive ids even when a subject lost its last active lesson. No lesson bodies are needed by sync. */
export function inactiveIds(index: Index, pages: Pick<LessonPage, "lesson">[], tombstones: Pick<Tombstone, "id">[]): string[] {
  const active = new Set(index.lessons.map((l) => l.id));
  return [...new Set([...pages.map((p) => p.lesson.id), ...tombstones.map((t) => t.id)])].filter((id) => !active.has(id)).sort();
}

export interface Shards {
  built_at: string;
  subjects: Record<string, { lessons: number }>;
  shards: Record<string, { built_at: string; subject: string; lessons: (IndexEntry & { models?: Record<string, "knows" | "misses"> })[] }>;
}

/** lesson id → model id → knows | misses, measured by FreshBench. Empty until a run writes it. */
export function readModelVerdicts(root = join(process.cwd(), "../..")): ModelVerdicts {
  return readModels(root)?.lessons ?? {};
}

export function shardsOf(index: Index, verdicts: ModelVerdicts = readModelVerdicts()): Shards {
  const shards: Shards["shards"] = {};
  for (const l of index.lessons) {
    if (l.format !== 1) continue;
    const shard = (shards[l.subject] ??= { built_at: index.built_at, subject: l.subject, lessons: [] });
    shard.lessons.push(verdicts[l.id] ? { ...l, models: verdicts[l.id] } : l);
  }
  const subjects = Object.fromEntries(Object.entries(shards).map(([s, sh]) => [s, { lessons: sh.lessons.length }]));
  return { built_at: index.built_at, subjects, shards };
}
