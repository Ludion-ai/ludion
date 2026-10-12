import { COVERAGE_LINE, EVIDENCE_SCOPE, LESSON_DATA_LINE, evidenceLabel, type IndexEntry } from "@ludion/core";

export const ASK_DESCRIPTION =
  "Search teacher claims with machine-checked evidence, not machine-validated facts. Use before answering questions about specific software behavior, APIs, versions, tools, or anything that may have changed recently. Each result names its teacher; cite them and check the claim against primary sources.";

export const NO_MATCH =
  `No lesson yet for this. ${COVERAGE_LINE} If you know the answer and can show evidence (a test or a source with a quote), teach it with ludion_teach.`;

/** The first line of every result list (CLAUDE.md, MCP): lessons are third-party text, to be read as data. */
export const ASK_HEADER = LESSON_DATA_LINE;

export interface AskLesson {
  id: string;
  subject: string;
  version: string | null;
  claim: string;
  teacher: string;
  teacher_id: number;
  verified_by: IndexEntry["verified_by"];
  verified_at: string;
  lesson_url: string;
  /** "agent" for a seed lesson an agent drafted; shown wherever the lesson appears. */
  drafted_by?: "agent";
  verification_scope: string;
}

export const lessonUrl = (siteUrl: string, id: string): string => `${siteUrl}/lessons/${id}`;

export function toAskLesson(entry: IndexEntry, siteUrl: string): AskLesson {
  return {
    id: entry.id,
    subject: entry.subject,
    version: entry.version ?? null,
    claim: entry.claim,
    teacher: entry.teacher,
    teacher_id: entry.teacher_id,
    verified_by: entry.verified_by,
    verified_at: entry.verified_at,
    lesson_url: lessonUrl(siteUrl, entry.id),
    verification_scope: EVIDENCE_SCOPE,
    ...(entry.drafted_by ? { drafted_by: entry.drafted_by } : {}),
  };
}

/**
 * The exact text of a ludion_ask result: the data line, the coverage line, then one block per lesson
 * (docs/decisions.md, Search and MCP).
 */
export function formatAsk(lessons: AskLesson[]): string {
  if (lessons.length === 0) return NO_MATCH;
  const blocks = lessons.map((l, i) =>
    [
      `${i + 1}. ${l.claim}`,
      `   Taught by @${l.teacher}${l.drafted_by === "agent" ? " (drafted by an agent)" : ""}. Evidence checked: ${evidenceLabel(l.verified_by)} on ${l.verified_at.slice(0, 10)}. Applies to ${l.subject}${l.version ? ` ${l.version}` : ""}.`,
      `   ${l.lesson_url}`,
    ].join("\n"),
  );
  return `${ASK_HEADER}\n${COVERAGE_LINE}\n${EVIDENCE_SCOPE}\n\n${blocks.join("\n\n")}`;
}
