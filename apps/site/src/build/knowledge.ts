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

/** A stretch of the date axis with no dot, cutoff, or measuring day in it longer than this many days is cut short. */
export const GAP_DAYS = 45;
/** How many days' width a cut stretch keeps. */
const CUT_WIDTH = 14;

/**
 * The knowledge dates: an axis from the earliest cutoff month (or first release) to the measuring day, and for each
 * model a dot per dated lesson, in date order. Long empty stretches are cut short (`breaks`, drawn as a break in the
 * axis) so that one old lesson doesn't squeeze the rest into a corner; no month tick falls inside a cut.
 */
export function dateAxis(k: Knowledge, dates: ReleaseDates | null) {
  const dated = k.lessons.filter((l) => l.released).sort((a, b) => a.released!.localeCompare(b.released!));
  if (!dated.length || !k.measuredAt) return null;
  const lastDay = (month: string) => new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const cutoffs = k.models.map((m) => dates?.cutoffs[m.id]).filter((c) => c != null);
  // Days the axis must show at full scale: each dot, each cutoff month's ends, the measuring day.
  const marks = [...new Set([...dated.map((l) => dayOf(l.released!)), ...cutoffs.flatMap((c) => [dayOf(`${c.month}-01`), dayOf(lastDay(c.month))]), dayOf(k.measuredAt)])].sort((a, b) => a - b);
  const from = marks[0]! - 6;
  const to = marks.at(-1)! + 4;
  // Piecewise: [day, position in days] at each mark, with long gaps between marks shortened.
  const knots: [number, number][] = [[from, 0]];
  const breaks: number[] = [];
  let pos = 6;
  knots.push([marks[0]!, pos]);
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i]! - marks[i - 1]!;
    if (gap > GAP_DAYS) {
      breaks.push(pos + CUT_WIDTH / 2);
      pos += CUT_WIDTH;
    } else pos += gap;
    knots.push([marks[i]!, pos]);
  }
  knots.push([to, pos + 4]);
  const length = pos + 4;
  const at = (day: number) => {
    const j = Math.max(1, knots.findIndex(([d]) => d >= day));
    const [d0, p0] = knots[j - 1]!;
    const [d1, p1] = knots[j] ?? knots.at(-1)!;
    return (d1 === d0 ? p0 : p0 + ((day - d0) / (d1 - d0)) * (p1 - p0)) / length;
  };
  const isCut = (day: number) => marks.some((m, i) => i > 0 && m - marks[i - 1]! > GAP_DAYS && day > marks[i - 1]! && day < m);
  const x = (date: string) => at(dayOf(date));
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
  const ticks: { x: number; month: string; line: boolean }[] = [];
  const first = new Date(from * 86_400_000);
  for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); d.getTime() / 86_400_000 <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const day = d.getTime() / 86_400_000;
    if (!isCut(day)) ticks.push({ x: at(day), month: d.toISOString().slice(0, 7), line: true });
  }
  // A stretch between cuts with no month start in it gets a label at its first mark instead (no line), so every dot
  // has a month to read it against.
  const edges = [0, ...breaks.map((p) => p / length), 1];
  for (let i = 0; i + 1 < edges.length; i++) {
    if (ticks.some((t) => t.x > edges[i]! && t.x < edges[i + 1]!)) continue;
    const day = marks.find((m) => at(m) > edges[i]! && at(m) < edges[i + 1]!);
    if (day != null) ticks.push({ x: at(day), month: new Date(day * 86_400_000).toISOString().slice(0, 7), line: false });
  }
  ticks.sort((p, q) => p.x - q.x);
  const undated = k.lessons.filter((l) => !l.released);
  return {
    rows,
    ticks,
    breaks: breaks.map((p) => p / length),
    measured: x(k.measuredAt),
    /** The dated lessons' first and last day, for the chart's words. */
    first: dated[0]!.released!,
    last: dated.at(-1)!.released!,
    dated: dated.length,
    notNpm: undated.filter((l) => !l.npm).length,
    unfetched: undated.filter((l) => l.npm).length,
  };
}
