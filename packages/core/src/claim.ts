// Format 1 lessons have no free-written claim. The sentence assistants read is generated from the structured
// fields; the only free text is `detail`, and every meaningful word in it must appear in the evidence (CLAUDE.md,
// "Claims are generated, not written").
import semver from "semver";
import { stem, tokenize } from "./search.ts";
import type { Lesson, LessonV1 } from "./types.ts";
import { isV1 } from "./types.ts";

/** The directory for a package: npm @scope/name → scope.name; anything else lowercased as is. */
export function subjectFor(pkg: LessonV1["package"]): string {
  return pkg.name.replace(/^@/, "").replace("/", ".").toLowerCase();
}

/** A code span. The schema forbids backticks in symbols; stripping them here too means no field can end the span early. */
const code = (s: string) => `\`${s.replace(/`/g, "")}\``;

/** The detail as a sentence: its own case kept (it may start with an identifier), a full stop added. */
function sentence(text: string): string {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** The sentence an assistant reads, built from the fields. Same fields, same sentence. */
export function generateClaim(l: Pick<LessonV1, "package" | "versions" | "kind" | "symbol" | "replacement" | "signal" | "detail">): string {
  const where = `${l.package.name} ${l.versions}`;
  const use = l.replacement ? `; use ${code(l.replacement)} instead` : "";
  const head = {
    removed: `${where} removed ${code(l.symbol)}${use}.`,
    renamed: `${where} renamed ${code(l.symbol)} to ${code(l.replacement ?? "")}.`,
    deprecated: `${where} deprecated ${code(l.symbol)}${use}.`,
    added: `${where} added ${code(l.symbol)}.`,
    default: `${where} changed the default of ${code(l.symbol)}.`,
    behavior: `${where} changed what ${code(l.symbol)} does.`,
  }[l.kind];
  const parts = [head];
  if (l.detail) parts.push(sentence(l.detail));
  if (l.signal === "silent") parts.push("Silent: code written for older versions still runs, without an error.");
  return parts.join(" ");
}

/** The claim of any lesson: format 0's as written, format 1's generated. */
export function claimOf(l: Lesson): string {
  return isV1(l) ? generateClaim(l) : l.claim;
}

/** Where the fact holds, for display: format 0's version, format 1's versions. */
export function versionOf(l: Lesson): string | undefined {
  return isV1(l) ? l.versions : (l.version ?? undefined);
}

/**
 * Words that carry no claim of their own. Everything else must be grounded, including negations (not, no, never,
 * without), comparatives (more, only, before, after), modals (must, should), and numbers: dropping those would let a
 * detail say the opposite of its evidence.
 */
const NEUTRAL = new Set("a an the and or of to in on at by for from with as is are was were be been being it its this that these those which who".split(" "));

/** Meaningful words: lowercased, neutral words dropped, lightly stemmed. */
function meaningful(text: string): string[] {
  return tokenize(text).filter((t) => !NEUTRAL.has(t)).map(stem);
}

/**
 * What a detail may draw on: the source quotes, which are someone else's words found on a public page, and the fields
 * the claim already states. Not test code or expected errors: the teacher writes those, so they would ground anything.
 */
function evidenceText(l: LessonV1): string {
  const parts = [l.package.name, l.versions, l.symbol, l.replacement ?? ""];
  for (const e of l.evidence) if ("source" in e) parts.push(e.source.quote);
  return parts.join("\n");
}

/** Words in `detail` that appear nowhere in the evidence. Empty when the detail is grounded (or absent). */
export function ungroundedWords(l: LessonV1): string[] {
  if (!l.detail) return [];
  const known = new Set(meaningful(evidenceText(l)));
  return [...new Set(meaningful(l.detail))].filter((w) => !known.has(w));
}

const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[`'"“”‘’]/g, "").replace(/\s+/g, " ");

/** Source quotes must state the fact itself, so each must name the symbol. Returns the quotes that don't. */
export function quotesMissingSymbol(l: LessonV1): string[] {
  const symbol = normalize(l.symbol);
  return l.evidence.flatMap((e) => ("source" in e && !normalize(e.source.quote).includes(symbol) ? [e.source.quote] : []));
}

/**
 * What the schema can't say about a format 1 lesson, in plain words: the subject matches the package, `versions` is a
 * real semver range, the detail is grounded, and every source quote names the symbol. `verify` and `ludion teach`
 * both run these. Empty when the lesson is fine.
 */
export function lessonProblems(l: LessonV1): string[] {
  const problems: string[] = [];
  if (l.subject !== subjectFor(l.package)) problems.push(`The subject for package ${l.package.name} is ${subjectFor(l.package)}, not ${l.subject}.`);
  const range = semver.validRange(l.versions);
  // A range that means every version (*, x, ||||) can't describe a change, and empty || alternatives are a typo.
  if (range == null || range === "*" || /^\s*\|\||\|\|\s*(\|\||$)/.test(l.versions)) problems.push(`versions "${l.versions}" is not a range of versions where the fact holds. Write one like >=5.0.0 or ^4.2.0.`);
  const words = ungroundedWords(l);
  if (words.length) problems.push(`The detail uses words no source quote contains: ${words.join(", ")}. Use the quotes' own words, or leave the detail out.`);
  for (const quote of quotesMissingSymbol(l)) problems.push(`The quote "${quote.slice(0, 80)}" doesn't name ${l.symbol}. Quote a sentence that states the fact itself, not a headline.`);
  return problems;
}