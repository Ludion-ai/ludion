// Recount of definitions §3 from lold2.json's rows, without the runner's rounding. The execution rounded each
// difference to 0.01 h before its statistics and buckets (run-lold2.ts `hours`), so a commit made seconds after the
// publish fell in (-1h, 0h]. This reads only the committed timestamps; nothing is fetched.
// Usage: node recount-tag-time.ts <lold2.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { timeStats } from "./lold2.ts";

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) throw new Error("Usage: node recount-tag-time.ts <lold2.json> <out.json>");
const rows = (JSON.parse(readFileSync(inFile, "utf8")) as { rows: { genuine: any[] } }).rows.genuine;
const diff = (publish: string, at: string) => (Date.parse(at) - Date.parse(publish)) / 3.6e6;
const timed = rows.filter(r => r.release_time?.kind === "tag" && r.release_time.committer_time && r.publish_time);
const tagged = timed.filter(r => r.release_time.tagger_time);
const prov = rows.filter(r => r.release_time?.kind === "provenance" && r.release_time.committer_time && r.publish_time);
const commit = timed.map(r => diff(r.publish_time, r.release_time.committer_time));
const out = {
  from: inFile,
  tag_rows_timed: timed.length,
  commit_minus_publish_hours: timeStats(commit),
  commit_before_publish: commit.filter(h => h < 0).length,
  commit_after_publish: timed.filter((_, i) => commit[i]! > 0).map(r => ({ row: `${r.name}@${r.version}`, seconds: Math.round(diff(r.publish_time, r.release_time.committer_time) * 3600) })),
  commit_equal_to_publish: commit.filter(h => h === 0).length,
  annotated: tagged.length,
  tagger_minus_publish_hours: timeStats(tagged.map(r => diff(r.publish_time, r.release_time.tagger_time))),
  provenance_commit_minus_publish_hours: timeStats(prov.map(r => diff(r.publish_time, r.release_time.committer_time))),
};
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
