#!/usr/bin/env node
// Calibrates the pipeline's reviewer on lessons people already accepted: runs the same per-lesson review (review.ts)
// on the active seed lessons on main, with each one's verified answer key as the "entry". The finding rate on accepted
// lessons is the baseline to read the pipeline's finding counts against.
//   node tools/seed/src/calibrate.ts <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { activeSet, generateClaim, isV1, validateLesson, type Lesson, type LessonV1 } from "@ludion/core";
import { ask, extractJson, pool } from "./llm.ts";
import { parseFindings, reviewPrompt } from "./review.ts";

const ROOT = resolve(import.meta.dirname, "../../..");

const out = process.argv[2];
if (!out) throw new Error("Usage: node tools/seed/src/calibrate.ts <out.json>");
const lessons: Lesson[] = [];
for (const s of readdirSync(join(ROOT, "lessons"), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  for (const f of readdirSync(join(ROOT, "lessons", s.name)).filter((f) => f.endsWith(".json"))) {
    const v = validateLesson(JSON.parse(readFileSync(join(ROOT, "lessons", s.name, f), "utf8")));
    if (v.ok) lessons.push(v.lesson);
  }
}
const seeds = activeSet(lessons).filter((l): l is LessonV1 => isV1(l) && l.drafted_by === "agent");
const changeOf = new Map(Object.entries(JSON.parse(readFileSync(join(ROOT, "docs/bench/2026-10-11-done3/seeds.json"), "utf8")) as Record<string, string>).map(([c, id]) => [id, c]));
const keys = new Map((JSON.parse(readFileSync(join(ROOT, "docs/bench/2026-10-11-keys/keys.json"), "utf8")) as { changes: { id: string; answer: string; primary_quote?: string }[] }).changes.map((k) => [k.id, k]));
const results = await pool(seeds, 4, async (l) => {
  const key = keys.get(changeOf.get(l.id) ?? (l.replaces?.length ? changeOf.get(l.replaces[0]!) ?? "" : ""));
  const entry = key ? `${key.answer}${key.primary_quote ? `\n\nPrimary source: "${key.primary_quote}"` : ""}` : "(no changelog entry on file; judge from the lesson's own evidence)";
  const r = await ask(reviewPrompt(l.package.name, l, generateClaim(l), entry), "claude-opus-5-5", 3);
  return { id: l.id, subject: l.subject, findings: parseFindings(extractJson(r.answer)) };
});
const rows = results.map((r, i) => (r instanceof Error ? { id: seeds[i]!.id, error: r.message, findings: [] } : r));
writeFileSync(out, JSON.stringify(rows, null, 2) + "\n");
const n = rows.reduce((s, r) => s + r.findings.length, 0);
console.log(`calibrate: ${rows.length} accepted seed lessons, ${n} findings, ${rows.filter((r) => r.findings.length === 0 && !("error" in r)).length} with none.`);
