import { runSlug, type Done3 } from "./bench.ts";

// Pinned to the recorded demonstration in docs/demo/README.md, not chosen by the largest improvement.
const DEMO_QUESTION = "vitest-5-0-0-14-b";
export function homeComparison(done3: Done3 | null) {
  if (!done3) return null;
  const question = done3.questions.find((q) => q.id === DEMO_QUESTION);
  if (!question) return null;
  const before = done3.runs.find((r) => !r.sync && r.condition === "project");
  const after = done3.runs.find((r) => r.sync && r.condition === "project" && r.model === before?.model);
  if (!before || !after) return null;
  const pair = [before, after].map((run) => {
    const answer = run.answers.find((a) => a.id === question.id);
    const grade = run.grades.find((g) => g.id === question.id);
    if (!answer?.answer.trim() || answer.isError || !grade) return null;
    const paragraph = answer.answer.trim().split(/\n\s*\n/)[0]!;
    const excerpt = paragraph.match(/^.*?[.!?]\s+.*?[.!?](?=\s|$)/s)?.[0] ?? paragraph;
    return { excerpt, answer: answer.answer, grade: grade.grade, href: `/bench/${run.model}/${runSlug(question.id, run)}/` };
  });
  if (!pair[0] || !pair[1] || pair[0].grade !== "wrong" || pair[1].grade !== "correct") return null;
  return { question: question.question, model: before.model, measuredAt: done3.measuredAt, frozenAt: done3.frozenAt, before: pair[0], after: pair[1] };
}
