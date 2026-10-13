// Build-time data for every page. Runs in Node during `astro build` only; never shipped to the browser.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  buildIndex, RESERVED_SUBJECTS, resolveLogins, storedLogin, validateLesson, verifiedBy,
  type GitInfo, type Index, type Lesson, type VerifiedBy,
} from "@ludion/core";
import { ADDED_LOG_FORMAT, DELETED_LOG_FORMAT, parseAddedLog, parseDeletedLog } from "./git-info.ts";
import { readDone3, type Done3 } from "./bench.ts";
import { readModels, type Models } from "./models.ts";
import { teacherPages } from "./teacher-pages.ts";

export interface Config {
  org: string;
  repo: string;
  site: string;
}

export interface LessonPage {
  lesson: Lesson;
  teacher: string;
  verified_by: VerifiedBy;
  verified_at: string;
  pr: number | null;
  /** Lessons this one corrects, and the lesson that corrects it, if any. */
  corrects: string[];
  correctedBy: string | null;
  /** The date of the nightly check that found this lesson failing (it is withheld from the index), else null. */
  failedCheckAt: string | null;
}

/** A retracted lesson: its file was deleted from main. Its page stays, struck through, so links keep working. */
export interface Tombstone {
  id: string;
  subject: string;
  /** The lesson as it was before deletion; undefined if that version can't be read as a lesson. */
  lesson?: Lesson;
  teacher?: string;
  retracted_at: string;
  pr: number | null;
}

export interface SiteData {
  config: Config;
  /** The repository's root folder: /bench reads run logs from docs/bench under it. */
  root: string;
  /** Retracted lessons, newest retraction first. */
  tombstones: Tombstone[];
  /** FreshBench per-model verdicts (docs/bench/models.json), or null before the first run. */
  models: Models | null;
  /** The official Done 3 FreshBench run (docs/bench/2026-10-11-done3/), or null if its files aren't there. */
  done3: Done3 | null;
  /** index.json: the active set. */
  index: Index;
  /** Every lesson on main, replaced ones included, newest verified first. */
  pages: LessonPage[];
  /** Lowercase login → teacher id that owns /teachers/<login>/. */
  teacherPages: Map<string, number>;
  /** Current login for a teacher id. */
  loginOf: (id: number) => string;
  /** Path of the teacher's page, or null if they have none. */
  teacherHref: (id: number) => string | null;
  /** Avatar URL by id (survives renames). Sample builds use monograms, never real GitHub accounts. */
  avatarOf: (id: number, size: number) => string;
  /** True when built from apps/site/samples (LUDION_SAMPLES=1). */
  samples: boolean;
}

const SIZE_WARNING = 5 * 1024 * 1024;

// Sample lessons for checking the design (docs/decisions.md, Site). They live outside lessons/, build only with
// LUDION_SAMPLES=1 into dist-samples (astro.config.mjs), and never in a deploy build.
const SAMPLES = process.env.LUDION_SAMPLES === "1";
if (SAMPLES && (process.env.WORKERS_CI || process.env.CF_PAGES)) {
  throw new Error("LUDION_SAMPLES=1 is set in a Cloudflare build. Sample lessons must never be deployed; unset it.");
}

function sampleMeta(root: string): { teachers: Record<string, string>; git: GitInfo } {
  return JSON.parse(readFileSync(join(root, "apps/site/samples/meta.json"), "utf8"));
}

/** A data: URI avatar with the login's first letter, for fictional sample teachers. Gray only: the site has no hue. */
function monogram(login: string, id: number): string {
  const lightness = 22 + ((id * 7) % 4) * 6;
  const letter = login.charAt(0).toUpperCase().replace(/[^A-Z0-9]/, "?");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(0 0% ${lightness}%)"/><text x="20" y="26.5" text-anchor="middle" font-family="sans-serif" font-size="18" font-weight="600" fill="#fff">${letter}</text></svg>`;
return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

function readLessons(dir: string): Lesson[] {
  const lessons: Lesson[] = [];
  for (const subject of readdirSync(dir, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    for (const file of readdirSync(join(dir, subject.name))) {
      if (!file.endsWith(".json")) continue;
      const path = join(dir, subject.name, file);
      const v = validateLesson(JSON.parse(readFileSync(path, "utf8")));
      if (!v.ok) throw new Error(`${path} is not a valid lesson: ${v.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
      lessons.push(v.lesson);
    }
  }
  return lessons;
}

/** Lessons deleted from main and not back since, read as they were just before deletion. */
function tombstonesOf(root: string, present: Set<string>): Tombstone[] {
  const deleted = parseDeletedLog(git(root, "log", "--diff-filter=D", "--name-only", `--format=${DELETED_LOG_FORMAT}`, "--", "lessons/"));
  const out: Tombstone[] = [];
  for (const [id, d] of Object.entries(deleted)) {
    if (present.has(id)) continue;
    let lesson: Lesson | undefined;
    try {
      const v = validateLesson(JSON.parse(git(root, "show", `${d.commit}^:${d.path}`)));
      if (v.ok) lesson = v.lesson;
    } catch {
      // The old version may not parse under today's schema; the tombstone still names the id and the retraction.
    }
    out.push({ id, subject: d.path.split("/")[1]!, lesson, retracted_at: d.retracted_at, pr: d.pr });
  }
  return out.sort((a, b) => (a.retracted_at < b.retracted_at ? 1 : -1));
}

/** A subject named like a top-level page would be shadowed by it: fail the build with what to do. */
export function reservedSubjects(subjects: Iterable<string>): string[] {
  return [...new Set(subjects)].filter((s) => RESERVED_SUBJECTS.has(s));
}

/**
 * Lessons the nightly reverify found failing (LUDION_WITHHOLD: its failing.json, which deploy.yml downloads). They
 * stay on main until a retraction merges, but leave the index, the shards, and search at once. Ids only; anything
 * else in the file is ignored.
 */
export function readWithheld(root: string, path = process.env.LUDION_WITHHOLD): { ids: Set<string>; checkedAt: string | null } {
  const file = path ? (isAbsolute(path) ? path : join(root, path)) : undefined;
  if (!file || !existsSync(file)) return { ids: new Set(), checkedAt: null };
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { checked_at?: unknown; failing?: { id?: unknown }[] };
  const ids = (parsed.failing ?? []).map((f) => f.id).filter((id): id is string => typeof id === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id));
  return { ids: new Set(ids), checkedAt: typeof parsed.checked_at === "string" ? parsed.checked_at : null };
}

function gitInfo(root: string): GitInfo {
  if (git(root, "rev-parse", "--is-shallow-repository").trim() === "true") {
    console.log("[ludion] Shallow clone: fetching full history for verified_at and pr.");
    git(root, "fetch", "--unshallow", "--quiet");
  }
  return parseAddedLog(git(root, "log", "--diff-filter=A", "--name-only", `--format=${ADDED_LOG_FORMAT}`, "--", "lessons/"));
}

async function load(): Promise<SiteData> {
  const root = git(process.cwd(), "rev-parse", "--show-toplevel").trim();
  const config = JSON.parse(readFileSync(join(root, "ludion.config.json"), "utf8")) as Config;
  const samples = SAMPLES ? sampleMeta(root) : null;
  const all = readLessons(join(root, samples ? "apps/site/samples/lessons" : "lessons"));
  const info = samples ? samples.git : gitInfo(root);

  const deleted = samples ? [] : tombstonesOf(root, new Set(all.map((l) => l.id)));
  // Retracted lessons' teachers too: a tombstone shows their current login, looked up by id like everyone's.
  const ids = new Set([...all, ...deleted.flatMap((t) => (t.lesson ? [t.lesson] : []))].map((l) => l.author_id));
  const resolved = samples
    ? new Map(Object.entries(samples.teachers).map(([id, login]) => [Number(id), login]))
    : await resolveLogins(ids, fetch, process.env.GITHUB_READ_TOKEN || undefined);
  for (const id of ids) {
    if (!resolved.has(id)) console.warn(`[ludion] Could not look up GitHub user ${id}; using the login stored in their newest lesson.`);
  }
  // Current login for every teacher, active or not: the API's answer, else the newest stored login.
  const logins = new Map(resolved);
  for (const l of [...all].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))) {
    if (!logins.has(l.author_id)) logins.set(l.author_id, storedLogin(l.author));
  }

  const clash = reservedSubjects(all.map((l) => l.subject));
  if (clash.length) throw new Error(`Subject ${clash.join(", ")} is also a top-level page of the site, so its subject page can't be built. Add a check for it in verify, or rename the page.`);
  const withheld = samples ? { ids: new Set<string>(), checkedAt: null } : readWithheld(root);
  if (withheld.ids.size) console.log(`[ludion] Withholding ${withheld.ids.size} lesson(s) failing the nightly reverify: ${[...withheld.ids].join(", ")}`);
  const index = buildIndex(all, info, resolved, { ...config, withhold: withheld.ids });
  const json = JSON.stringify(index);
  if (json.length > SIZE_WARNING) console.warn(`[ludion] index.json is ${(json.length / 1048576).toFixed(1)} MB, above 5 MB. The Worker and the ask box load it whole.`);

  const correctedBy = new Map<string, string>();
  for (const l of all) for (const old of l.replaces ?? []) correctedBy.set(old, l.id);
  const pages: LessonPage[] = all
    .map((lesson) => ({
      lesson,
      teacher: logins.get(lesson.author_id)!,
      verified_by: verifiedBy(lesson),
      verified_at: info[lesson.id]?.verified_at ?? lesson.created_at,
      pr: info[lesson.id]?.pr ?? null,
      corrects: lesson.replaces ?? [],
      correctedBy: correctedBy.get(lesson.id) ?? null,
      failedCheckAt: withheld.ids.has(lesson.id) ? (withheld.checkedAt ?? "") : null,
    }))
    .sort((a, b) => (a.verified_at < b.verified_at ? 1 : a.verified_at > b.verified_at ? -1 : 0));

  // Pages only for teachers with active lessons.
  const activeTeachers = new Map([...logins].filter(([id]) => String(id) in index.teachers));
  const owners = teacherPages(activeTeachers, new Set(resolved.keys()));
  const pageOf = new Map([...owners].map(([name, id]) => [id, name]));

  return {
    config,
    root,
    tombstones: deleted.map((t) => (t.lesson ? { ...t, teacher: resolved.get(t.lesson.author_id) ?? logins.get(t.lesson.author_id) ?? storedLogin(t.lesson.author) } : t)),
    models: readModels(root),
    done3: readDone3(root),
    index,
    pages,
    teacherPages: owners,
    loginOf: (id) => logins.get(id) ?? String(id),
    teacherHref: (id) => (pageOf.has(id) ? `/@${pageOf.get(id)}` : null),
    avatarOf: (id, size) => (samples ? monogram(logins.get(id) ?? "?", id) : `https://avatars.githubusercontent.com/u/${id}?s=${size * 2}`),
    samples: samples !== null,
  };
}

let cached: Promise<SiteData> | undefined;
/** Loaded once per build and shared by every page. */
export function siteData(): Promise<SiteData> {
  return (cached ??= load());
}
