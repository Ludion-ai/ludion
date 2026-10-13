#!/usr/bin/env node
// Scores candidate subjects (docs/decisions.md, "Choosing subjects"): how often AI writes code with the package ×
// how often it releases × what share of its changelog entries are silent changes, over the same window.
//   node tools/seed/src/score.ts <dir with one collect+triage run per package> [--out <scores.json>]
// "AI writes it often" has no direct measure; npm's weekly downloads stand in for it, and the table says so.
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Entry } from "./collect.ts";
import { read, type RunInfo } from "./io.ts";
import type { Verdict } from "./triage.ts";

export interface SubjectScore {
  package: string;
  weekly_downloads: number;
  releases: number;
  entries: number;
  candidates: number;
  /** Candidates that aren't additions and are silent: code written for the older version still runs, differently. */
  silent_changes: number;
  silent_share: number;
  score: number;
  /** Why it can't be scored (release notes missing or unreadable), if so. */
  unmeasured?: string;
}

/** Each factor on a log scale where it is heavy-tailed, divided by the largest, multiplied. */
export function score(rows: Omit<SubjectScore, "score">[]): SubjectScore[] {
  const measured = rows.filter((r) => !r.unmeasured);
  const max = (f: (r: Omit<SubjectScore, "score">) => number) => Math.max(...measured.map(f), 1e-9);
  const dl = (r: Omit<SubjectScore, "score">) => Math.log10(1 + r.weekly_downloads);
  const rel = (r: Omit<SubjectScore, "score">) => Math.log10(1 + r.releases);
  const [mDl, mRel, mShare] = [max(dl), max(rel), max((r) => r.silent_share)];
  return rows
    .map((r) => ({ ...r, score: r.unmeasured ? 0 : Number(((dl(r) / mDl) * (rel(r) / mRel) * (r.silent_share / mShare)).toFixed(3)) }))
    .sort((a, b) => b.score - a.score);
}

async function weeklyDownloads(pkg: string): Promise<number> {
  const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${pkg}`);
  return res.ok ? ((await res.json()) as { downloads: number }).downloads : 0;
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string" } } });
  const root = positionals[0];
  if (!root) throw new Error("Usage: node tools/seed/src/score.ts <dir> [--out scores.json]");
  const rows: Omit<SubjectScore, "score">[] = [];
  for (const d of readdirSync(root, { withFileTypes: true })) {
    const dir = join(root, d.name);
    if (!d.isDirectory() || !existsSync(join(dir, "run.json"))) continue;
    const run = read<RunInfo>(dir, "run.json");
    const entries = read<Entry[]>(dir, "entries.json");
    const triage = existsSync(join(dir, "triage.json")) ? read<Verdict[]>(dir, "triage.json") : [];
    const candidates = triage.filter((v) => v.candidate);
    const silent = candidates.filter((v) => v.kind !== "added" && v.signal === "silent").length;
    const notes = run.versions.length - run.missing.length;
    // Too few entries per release to tell: the notes are elsewhere (a CHANGELOG file, a blog) or in another format.
    const unmeasured = entries.length < Math.max(10, notes) ? `${entries.length} entries in ${notes} release notes on GitHub; the changelog is kept elsewhere or in another format` : undefined;
    rows.push({ package: run.package, weekly_downloads: await weeklyDownloads(run.package), releases: run.versions.length, entries: entries.length, candidates: candidates.length, silent_changes: silent, silent_share: entries.length ? Number((silent / entries.length).toFixed(3)) : 0, ...(unmeasured ? { unmeasured } : {}) });
  }
  const scored = score(rows);
  if (values.out) writeFileSync(values.out, JSON.stringify(scored, null, 2) + "\n");
  console.log("| package | weekly downloads | releases | entries | silent changes | silent share | score |\n| - | - | - | - | - | - | - |");
  for (const r of scored) console.log(`| ${r.package} | ${r.weekly_downloads} | ${r.releases} | ${r.entries} | ${r.silent_changes} | ${r.silent_share} | ${r.unmeasured ? `not scored: ${r.unmeasured}` : r.score} |`);
}

if (import.meta.main) await main();
