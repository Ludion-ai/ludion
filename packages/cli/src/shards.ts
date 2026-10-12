// The public index, one shard per subject: GET <site>/index/subjects.json, then <site>/index/<subject>.json for the
// subjects a project has installed. Built with the site from lessons on main, so it is what main says.
import { subjectFor, type IndexEntry } from "@ludion/core";
import type { Installed } from "./lockfile.ts";
import type { SyncLesson } from "./match.ts";
import { checkedShardLesson } from "./shard-check.ts";

export const SITE = process.env.LUDION_SITE || "https://ludion.ai";

export interface Subjects {
  built_at: string;
  subjects: Record<string, { lessons: number }>;
  /** Replaced, retracted, or withheld ids, including subjects with no active shard. */
  inactive_ids?: string[];
}

/** A shard's lesson: the index entry plus, when FreshBench measured it, which models know the change. */
export type ShardLesson = IndexEntry & { models?: Record<string, "knows" | "misses"> };

export interface Shard {
  built_at: string;
  subject: string;
  lessons: ShardLesson[];
}

type Fetch = (url: string) => Promise<Response>;

/** Every index request gives up after this long: sync runs at session start and must never stall it. */
const FETCH_TIMEOUT_MS = 5000;
const timedFetch: Fetch = (u) => fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
export const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Bound actual response bytes, even without a trustworthy Content-Length. */
export async function indexJson(res: Response): Promise<unknown> {
  if (!res.body) throw new Error("The index response has no JSON body.");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_INDEX_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error("The index response is too large. Sync refused to buffer it.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Subjects this project could have lessons for: each installed npm package, and the node runtime. */
export function wantedSubjects(installed: Installed): string[] {
  return [...new Set([...[...installed.npm.keys()].map((name) => subjectFor({ ecosystem: "npm", name })), "node"])];
}

export function shardLesson(raw: unknown): SyncLesson | undefined {
  const l = checkedShardLesson(raw);
  // Format 0 lessons have no package or range, so sync can't match them to a project.
  if (!l || !l.package || !l.version) return undefined;
  const models = (raw as ShardLesson).models;
  if (models !== undefined && (!object(models) || Object.values(models).some((v) => v !== "knows" && v !== "misses"))) throw new Error("The index's model verdicts are not valid.");
  return {
    id: l.id,
    package: l.package,
    versions: l.version,
    claim: l.claim,
    signal: l.signal,
    kind: l.kind,
    teacher: `@${l.teacher}`,
    verified: l.verified_by,
    verified_at: l.verified_at,
    url: `${SITE}/lessons/${l.id}`,
    drafted_by: l.drafted_by,
    models,
    origin: "index",
    replaces: l.replaces,
  };
}

/** Lessons from the shards of the subjects this project uses. Throws with a plain message when the site can't be reached. */
export async function fetchLessons(installed: Installed, fetchFn: Fetch = timedFetch): Promise<{ lessons: SyncLesson[]; built_at: string | null; subjects: Set<string>; inactiveIds: Set<string> | undefined }> {
  const res = await fetchFn(`${SITE}/index/subjects.json`);
  // A 404 is an error too: a site without shards (an old deploy, a wrong LUDION_SITE) says nothing about which lessons hold.
  if (!res.ok) throw new Error(`${SITE}/index/subjects.json answered ${res.status}.`);
  const data = await indexJson(res);
  if (!object(data) || typeof data.built_at !== "string" || !object(data.subjects) || Object.values(data.subjects).some((v) => !object(v) || !Number.isSafeInteger(v.lessons) || Number(v.lessons) < 0)) throw new Error("The index manifest is not valid Ludion data.");
  const subjects = data as unknown as Subjects;
  if (subjects.inactive_ids !== undefined && (!Array.isArray(subjects.inactive_ids) || subjects.inactive_ids.some((id) => typeof id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)))) {
    throw new Error("The index's inactive_ids must be a list of lesson ids.");
  }
  const wanted = wantedSubjects(installed).filter((s) => Object.hasOwn(subjects.subjects, s));
  const shards = await Promise.all(
    wanted.map(async (s) => {
      const r = await fetchFn(`${SITE}/index/${encodeURIComponent(s)}.json`);
      if (!r.ok) throw new Error(`${SITE}/index/${s}.json answered ${r.status}.`);
      const shard = await indexJson(r) as Shard;
      if (!object(shard) || shard.subject !== s || !Array.isArray(shard.lessons)) throw new Error("The index shard is not valid Ludion data.");
      if (shard.built_at !== subjects.built_at) throw new Error("The index changed during sync. Run ludion sync again to read one consistent build.");
      return shard;
    }),
  );
  const lessons = shards.flatMap((s) => s.lessons.map(shardLesson).filter((l): l is SyncLesson => !!l));
  return { lessons, built_at: subjects.built_at, subjects: new Set(Object.keys(subjects.subjects)), inactiveIds: subjects.inactive_ids === undefined ? undefined : new Set(subjects.inactive_ids) };
}
