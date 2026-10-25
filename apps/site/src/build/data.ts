// Build-time data for every page. Runs in Node during `astro build` only; never shipped to the browser.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { buildIndex, RESERVED_SUBJECTS, resolveLogins, validateLesson, type GitInfo, type Index, type Lesson } from "@ludion/core";
import { ADDED_LOG_FORMAT, parseAddedLog } from "./git-info.ts";
import { readModels, type Models } from "./models.ts";

export interface Config {
  org: string;
  repo: string;
  site: string;
}

export interface SiteData {
  config: Config;
  /** The repository's root folder. */
  root: string;
  /** FreshBench per-model verdicts (docs/bench/models.json), or null before the first run. Shards read the same file. */
  models: Models | null;
  /** index.json: the active set. */
  index: Index;
}

const SIZE_WARNING = 5 * 1024 * 1024;

// Sample lessons for checking the design. They live outside lessons/, build only with
// LUDION_SAMPLES=1 into dist-samples (astro.config.mjs), and never in a deploy build.
const SAMPLES = process.env.LUDION_SAMPLES === "1";
if (SAMPLES && (process.env.WORKERS_CI || process.env.CF_PAGES)) {
  throw new Error("LUDION_SAMPLES=1 is set in a Cloudflare build. Sample lessons must never be deployed; unset it.");
}

function sampleMeta(root: string): { teachers: Record<string, string>; git: GitInfo } {
  return JSON.parse(readFileSync(join(root, "apps/site/samples/meta.json"), "utf8"));
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
    git(root, "fetch", "--unshallow", "--quiet", "--no-tags", "origin", git(root, "rev-parse", "HEAD").trim());
  }
  return parseAddedLog(git(root, "log", "--diff-filter=A", "--name-only", `--format=${ADDED_LOG_FORMAT}`, "--", "lessons/"));
}

async function load(): Promise<SiteData> {
  const root = git(process.cwd(), "rev-parse", "--show-toplevel").trim();
  const config = JSON.parse(readFileSync(join(root, "ludion.config.json"), "utf8")) as Config;
  const samples = SAMPLES ? sampleMeta(root) : null;
  const all = readLessons(join(root, samples ? "apps/site/samples/lessons" : "lessons"));
  const info = samples ? samples.git : gitInfo(root);

  const ids = new Set(all.map((l) => l.author_id));
  const resolved = samples
    ? new Map(Object.entries(samples.teachers).map(([id, login]) => [Number(id), login]))
    : await resolveLogins(ids, fetch, process.env.GITHUB_READ_TOKEN || undefined);
  for (const id of ids) {
    if (!resolved.has(id)) console.warn(`[ludion] Could not look up GitHub user ${id}; using the login stored in their newest lesson.`);
  }

  const clash = reservedSubjects(all.map((l) => l.subject));
  if (clash.length) throw new Error(`Subject ${clash.join(", ")} is also a top-level page of the site, so its subject page can't be built. Add a check for it in verify, or rename the page.`);
  const withheld = samples ? { ids: new Set<string>(), checkedAt: null } : readWithheld(root);
  if (withheld.ids.size) console.log(`[ludion] Withholding ${withheld.ids.size} lesson(s) failing the nightly reverify: ${[...withheld.ids].join(", ")}`);
  const index = buildIndex(all, info, resolved, { ...config, withhold: withheld.ids });
  const json = JSON.stringify(index);
  if (json.length > SIZE_WARNING) console.warn(`[ludion] index.json is ${(json.length / 1048576).toFixed(1)} MB, above 5 MB. The Worker and the ask box load it whole.`);

  return { config, root, models: readModels(root), index };
}

let cached: Promise<SiteData> | undefined;
/** Loaded once per build and shared by every page. */
export function siteData(): Promise<SiteData> {
  return (cached ??= load());
}
