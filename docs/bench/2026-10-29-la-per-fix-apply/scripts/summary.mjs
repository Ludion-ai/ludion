// Prints a receipt's outcome, timestamps, branches and reasons (no source, no test output beyond the reason).
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const short = text => text ? String(text).replace(/\s+/g, " ").slice(0, 400) : text;
console.log(JSON.stringify({ outcome: r.outcome, reason: short(r.reason), base_commit: r.base_commit, baseline_passed: r.baseline_passed, tool_image: r.tool_image,
  ...(r.fixes ? { fixes: r.fixes.map(f => ({ package: f.package, changes: f.changes.map(c => `${c.from} -> ${c.to}`), outcome: f.outcome, branch: f.branch, commit: f.commit, fix_published_at: f.fix_published_at, fix_published_note: f.fix_published_note, found_at: f.found_at, applied_at: f.applied_at, candidate_passed: f.candidate_passed, carried_findings: f.carried_findings, reason: short(f.reason) })) }
    : { candidate: r.scan?.candidate, branch: r.branch, commit: r.commit, fix_published_at: r.fix_published_at, fix_published_note: r.fix_published_note, found_at: r.found_at, applied_at: r.applied_at, baseline_passed: r.baseline_passed, candidate_passed: r.candidate_passed }) }, null, 2));
