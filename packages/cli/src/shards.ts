// The public index, one shard per subject: GET <site>/index/subjects.json, then <site>/index/<subject>.json for the
// subjects a project has installed. Built with the site from lessons on main, so it is what main says.
import { subjectFor, type IndexEntry } from "@ludion/core";
import type { Installed } from "./lockfile.ts";
import type { SyncLesson } from "./match.ts";

export const SITE = process.env.LUDION_SITE || "https://ludion.ai";

export interface Subjects {
  built_at: string;
  subjects: Record<string, { lessons: number }>;
}

/** A shard's lesson: the index entry plus, when FreshBench measured it, which models know the change. */
export type ShardLesson = IndexEntry & { models?: Record<string, "knows" | "misses"> };

export interface Shard {
  built_at: string;
  subject: string;
  lessons: ShardLesson[];
}

type Fetch = (url: string) => Promise<Response>;

/** Subjects this project could have lessons for: each installed npm package, and the node runtime. */
export function wantedSubjects(installed: Installed): string[] {
  return [...new Set([...[...installed.npm.keys()].map((name) => subjectFor({ ecosystem: "npm", name })), "node"])];
}

export function shardLesson(l: ShardLesson): SyncLesson | undefined {
  // Format 0 lessons have no package or range, so sync can't match them to a project.
  if (l.format !== 1 || !l.package || !l.version) return undefined;
  return {
    id: l.id,
    package: l.package,
    versions: l.version,
    claim: l.claim,
    signal: l.signal,
    teacher: `@${l.teacher}`,
    verified: l.verified_by,
    verified_at: l.verified_at,
    url: `${SITE}/lessons/${l.id}`,
    drafted_by: l.drafted_by,
    models: l.models,
    origin: "index",
  };
}

/** Lessons from the shards of the subjects this project uses. Throws with a plain message when the site can't be reached. */
export async function fetchLessons(installed: Installed, fetchFn: Fetch = (u) => fetch(u)): Promise<{ lessons: SyncLesson[]; built_at: string | null }> {
  const res = await fetchFn(`${SITE}/index/subjects.json`);
  if (res.status === 404) return { lessons: [], built_at: null };
  if (!res.ok) throw new Error(`${SITE}/index/subjects.json answered ${res.status}.`);
  const subjects = (await res.json()) as Subjects;
  const wanted = wantedSubjects(installed).filter((s) => subjects.subjects[s]);
  const shards = await Promise.all(
    wanted.map(async (s) => {
      const r = await fetchFn(`${SITE}/index/${encodeURIComponent(s)}.json`);
      if (!r.ok) throw new Error(`${SITE}/index/${s}.json answered ${r.status}.`);
      return (await r.json()) as Shard;
    }),
  );
  const lessons = shards.flatMap((s) => s.lessons.map(shardLesson).filter((l): l is SyncLesson => !!l));
  return { lessons, built_at: subjects.built_at };
}
