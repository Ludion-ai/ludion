// A remote index must not bypass the lesson guards merely by moving text into a rendered claim or teacher label.
import { generateClaim, lessonProblems, validateLessonV1, verifiedBy, type IndexEntry, type LessonV1 } from "@ludion/core";

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const rejected = () => new Error("The index contains a lesson that is not valid structured Ludion data. Sync refused to write it.");

export function checkedShardLesson(raw: unknown): IndexEntry | undefined {
  if (!object(raw)) throw rejected();
  if (raw.format === undefined || raw.format === 0) return undefined; // old lessons cannot match installed versions
  if (raw.format !== 1 || typeof raw.claim !== "string" || raw.claim.length > 1000 || typeof raw.teacher !== "string") throw rejected();
  const lesson = {
    format: 1, id: raw.id, subject: raw.subject, package: raw.package, versions: raw.version, kind: raw.kind,
    symbol: raw.symbol, signal: raw.signal, evidence: raw.evidence, author: `github:${raw.teacher}`,
    author_id: raw.teacher_id, created_at: raw.verified_at,
    ...(raw.replacement === undefined ? {} : { replacement: raw.replacement }),
    ...(raw.drafted_by === undefined ? {} : { drafted_by: raw.drafted_by }),
    ...(raw.replaces === undefined ? {} : { replaces: raw.replaces }),
  };
  const initial = validateLessonV1(lesson);
  if (!initial.ok) throw rejected();
  const base = initial.lesson as LessonV1;
  // Current shards predate a separate detail field. Recover only the generated sentence's detail slot, then run
  // exactly the teaching guards and rebuild it. No remote claim is copied as arbitrary assistant instructions.
  const claim = generateClaim(base);
  let checked = base;
  if (raw.claim !== claim) {
    const suffix = base.kind === "added" ? " Older versions don't have it." : base.signal === "silent" ? " Silent: code written for older versions still runs, without an error." : "";
    const head = suffix ? claim.slice(0, -suffix.length) : claim;
    if (!raw.claim.startsWith(`${head} `) || (suffix && !raw.claim.endsWith(suffix))) throw rejected();
    const detail = raw.claim.slice(head.length + 1, suffix ? -suffix.length : undefined);
    // generateClaim may add a full stop to a detail already at the schema's length limit.
    const candidates = [detail, ...(detail.endsWith(".") ? [detail.slice(0, -1)] : [])];
    const valid = candidates.map((detail) => validateLessonV1({ ...base, detail })).find((v) => v.ok && generateClaim(v.lesson as LessonV1) === raw.claim);
    if (!valid?.ok) throw rejected();
    checked = valid.lesson as LessonV1;
  }
  if (lessonProblems(checked).length || raw.verified_by !== verifiedBy(checked)) throw rejected();
  return { ...(raw as unknown as IndexEntry), claim: generateClaim(checked) };
}
