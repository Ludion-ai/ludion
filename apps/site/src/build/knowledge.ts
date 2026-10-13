// What each model knows, lesson by lesson, for the knowledge strips, the knowledge dates, and the lesson list on
// /bench. Build time only. Verdicts come from docs/bench/models.json (via build/bench.ts's reading of it), publish
// dates from docs/bench/release-dates.json (scripts/release-dates.ts writes it from the npm registry; the build never
// goes to the network). An active lesson models.json has no verdict for is "not measured", never guessed.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import type { Index } from "@ludion/core";
import { cell, type Cell } from "./bench.ts";
import type { Models } from "./models.ts";

export const RELEASE_DATES = "docs/bench/release-dates.json";

export type Verdict = "knows" | "misses" | null;

export interface ReleaseDates {
  source: string;
  fetched_at: string;
  /** "<package>@<version>" → when npm published it (ISO). */
  versions: Record<string, string>;
  /** Model id → its published knowledge cutoff (YYYY-MM) and where it is published. */
  /** The page's row as it reads there (`quote`) and its definition of the term, so it can be checked offline. */
  cutoffs: Record<string, { month: string; url: string; row: string; quote: string; definition: string; checked_at: string }>;
}

export function readReleaseDates(root: string): ReleaseDates | null {
  const path = join(root, RELEASE_DATES);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ReleaseDates) : null;
}

export interface KnownLesson {
  id: string;
  subject: string;
  /** The range the fact holds for, as the lesson writes it. */
  versions: string;
  kind: string | null;
  signal: "loud" | "silent" | null;
  /**
   * Shown as silent: the signal is silent and the lesson isn't an addition. The claim says "Silent: code written for
   * older versions still runs" only then (generateClaim); for an addition the evidence shows only that older versions
   * lack it.
   */
  silent: boolean;
  /** Drafted by an agent (a seed lesson), labeled wherever it appears. */
  drafted: boolean;
  /** The claim's first sentence. */
  sentence: string;
  /** When npm published the lowest version the range admits (YYYY-MM-DD), if it is an npm package and known. */
  released: string | null;
  /** The lesson is about an npm package (so a missing date means release-dates.json predates its version). */
  npm: boolean;
  verdicts: Record<string, Verdict>;
}

export interface Strip {
  model: string;
  name: string;
  /** Lessons it doesn't know, out of the measured ones, with the 95% interval of that fraction. */
  misses: Cell;
  knows: number;
  notMeasured: number;
}

export interface Knowledge {
  lessons: KnownLesson[];
  models: { id: string; name: string }[];
  strips: Strip[];
  measuredAt: string | null;
}

/**
 * The first sentence of a claim: up to the first period outside a code span that ends the text or is followed by a
 * space, unless it ends an abbreviation ("e.g. this" goes on). A generated claim's detail may start with a symbol in
 * lower case, so what follows the space isn't checked.
 */
export function firstSentence(claim: string): string {
  let code = false;
  for (let i = 0; i < claim.length; i++) {
    if (claim[i] === "`") code = !code;
    else if (!code && claim[i] === "." && (i + 1 === claim.length || claim[i + 1] === " ") && !/\b(e\.g|i\.e|vs|cf)$/i.test(claim.slice(0, i))) return claim.slice(0, i + 1);
  }
  return claim;
}

/** A claim sentence as plain text, for a tooltip: code spans lose their backticks. */
export const plain = (text: string) => text.replace(/`/g, "");

type Entry = Index["lessons"][number] & { version?: string; kind?: string; signal?: "loud" | "silent"; package?: { ecosystem: string; name: string }; drafted_by?: string };

/** Every active lesson in subject order, then by version, with each model's verdict from models.json. */
export function knowledge(index: Index, models: Models | null, dates: ReleaseDates | null): Knowledge {
  const ids = Object.keys(models?.models ?? {});
  const lessons = (index.lessons as Entry[]).map((l): KnownLesson & { min: string | null } => {
    const min = l.version ? (semver.minVersion(l.version)?.version ?? null) : null;
    const at = l.package?.ecosystem === "npm" && min ? dates?.versions[`${l.package.name}@${min}`] : undefined;
    return {
      id: l.id,
      subject: l.subject,
      versions: l.version ?? "",
      kind: l.kind ?? null,
      signal: l.signal ?? null,
      silent: l.signal === "silent" && l.kind !== "added",
      drafted: l.drafted_by === "agent",
      sentence: firstSentence(l.claim),
      released: at ? at.slice(0, 10) : null,
      npm: l.package?.ecosystem === "npm",
      verdicts: Object.fromEntries(ids.map((m) => [m, models?.lessons[l.id]?.[m] ?? null])),
      min,
    };
  });
  lessons.sort((a, b) => a.subject.localeCompare(b.subject) || (a.min && b.min ? semver.compare(a.min, b.min) : 0) || a.id.localeCompare(b.id));
  const strips = ids.map((model): Strip => {
    const v = lessons.map((l) => l.verdicts[model]);
    const knows = v.filter((x) => x === "knows").length;
    const misses = v.filter((x) => x === "misses").length;
    return { model, name: models!.models[model]!.name, misses: cell(misses, knows + misses), knows, notMeasured: v.filter((x) => x === null).length };
  });
  return {
    lessons: lessons.map(({ min: _, ...l }) => l),
    models: ids.map((id) => ({ id, name: models!.models[id]!.name })),
    strips,
    measuredAt: models?.measured_at ?? null,
  };
}

/** Days since the epoch, UTC, for a YYYY-MM-DD date. */
export const dayOf = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

export interface Dot {
  lesson: KnownLesson;
  verdict: Verdict;
  /** 0..1 across the axis: the day npm published the lesson's first version. */
  x: number;
}

/**
 * The knowledge dates: an axis from the earliest cutoff month (or first release) to the measuring day, and for each
 * model a dot per dated lesson, in date order.
 */
export function dateAxis(k: Knowledge, dates: ReleaseDates | null) {
  const dated = k.lessons.filter((l) => l.released).sort((a, b) => a.released!.localeCompare(b.released!));
  if (!dated.length || !k.measuredAt) return null;
  const cutoffs = k.models.map((m) => dates?.cutoffs[m.id]).filter((c) => c != null);
  const starts = [...dated.map((l) => dayOf(l.released!)), ...cutoffs.map((c) => dayOf(`${c.month}-01`))];
  const from = Math.min(...starts) - 6;
  const to = Math.max(dayOf(k.measuredAt), ...dated.map((l) => dayOf(l.released!))) + 4;
  const x = (date: string) => (dayOf(date) - from) / (to - from);
  const lastDay = (month: string) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const rows = k.models.map((m) => {
    const c = dates?.cutoffs[m.id];
    return {
      model: m.id,
      name: m.name,
      dots: dated.map((lesson): Dot => ({ lesson, verdict: lesson.verdicts[m.id] ?? null, x: x(lesson.released!) })),
      // The cutoff is a month: the band covers it, first day to last.
      cutoff: c ? { from: x(`${c.month}-01`), to: x(lastDay(c.month)), month: c.month, url: c.url } : null,
    };
  });
  const ticks: { x: number; month: string }[] = [];
  const first = new Date(from * 86_400_000);
  for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); d.getTime() / 86_400_000 <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    ticks.push({ x: (d.getTime() / 86_400_000 - from) / (to - from), month: d.toISOString().slice(0, 7) });
  }
  const undated = k.lessons.filter((l) => !l.released);
  return {
    rows,
    ticks,
    measured: x(k.measuredAt),
    /** The dated lessons' first and last day, for the chart's words. */
    first: dated[0]!.released!,
    last: dated.at(-1)!.released!,
    dated: dated.length,
    notNpm: undated.filter((l) => !l.npm).length,
    unfetched: undated.filter((l) => l.npm).length,
  };
}
