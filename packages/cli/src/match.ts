// Which lessons a project needs: the package is installed at a version inside the lesson's range, and the target
// model is not measured to know the change (CLAUDE.md, "ludion sync").
import type { Kind } from "@ludion/core";
import semver from "semver";
import type { Installed } from "./lockfile.ts";

/** A lesson as sync sees it, from an index shard or the personal ledger. */
export interface SyncLesson {
  id: string;
  package: { ecosystem: "npm" | "pypi" | "runtime"; name: string };
  versions: string;
  claim: string;
  signal?: "loud" | "silent";
  kind?: Kind;
  /** "@login", or "you" for a lesson in the personal ledger. */
  teacher: string;
  /** How it was verified ("test", "differential", "source"), or why it isn't ("not verified: …"). */
  verified: string;
  verified_at?: string;
  url?: string;
  drafted_by?: "agent";
  /** Per model id: does that model already get this change right? Measured by FreshBench. */
  models?: Record<string, "knows" | "misses">;
  /** Where it came from. */
  origin: "index" | "ledger";
}

const coerce = (v: string) => semver.coerce(v)?.version;

/** The installed versions of a lesson's package that its range covers. Empty when it doesn't apply. */
export function matchingVersions(lesson: SyncLesson, installed: Installed): string[] {
  const { ecosystem, name } = lesson.package;
  let versions: string[] = [];
  if (ecosystem === "npm") versions = [...(installed.npm.get(name) ?? [])];
  else if (ecosystem === "runtime" && name === "node") versions = [installed.node];
  // pypi and python: not read from projects yet.
  return versions.filter((v) => {
    const exact = semver.valid(v) ?? coerce(v);
    return exact != null && semver.satisfies(exact, lesson.versions, { includePrerelease: true });
  });
}

/** True when FreshBench measured that this model already gets the change right: sync then leaves it out. */
export function modelKnows(lesson: SyncLesson, model: string | undefined): boolean {
  return model != null && lesson.models?.[model] === "knows";
}

export interface Selection {
  kept: { lesson: SyncLesson; versions: string[] }[];
  /** Matched the project's versions but the model is measured to know it. */
  prunedForModel: SyncLesson[];
}

/**
 * Silent changes first: an assistant can't find those out by running the code. Additions last: code that doesn't use
 * them is unaffected, whatever their signal.
 */
export function rank(lesson: SyncLesson): number {
  if (lesson.kind === "added") return 2;
  return lesson.signal === "silent" ? 0 : 1;
}

export function select(lessons: SyncLesson[], installed: Installed, model: string | undefined): Selection {
  const kept: Selection["kept"] = [];
  const prunedForModel: SyncLesson[] = [];
  const seen = new Set<string>();
  for (const lesson of lessons) {
    if (seen.has(lesson.id)) continue;
    seen.add(lesson.id);
    const versions = matchingVersions(lesson, installed);
    if (versions.length === 0) continue;
    if (modelKnows(lesson, model)) prunedForModel.push(lesson);
    else kept.push({ lesson, versions });
  }
  kept.sort((a, b) => rank(a.lesson) - rank(b.lesson) || a.lesson.package.name.localeCompare(b.lesson.package.name));
  return { kept, prunedForModel };
}
