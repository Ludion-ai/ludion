// Counts in a snapshot of the recorder's store that the README cites: stored OSV records (MAL- ones, and whether any
// names a watched package), and the repeats the replay drops, by record type. Reads data only. Run in Docker with no
// network, from the repository root, with the snapshot mounted read-only:
//   node docs/bench/2026-10-29-shadow-replay/scripts/store-counts.mjs /data tools/shadow/watched.json
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, watchedFile] = process.argv.slice(2);
const read = kind => readdirSync(join(dir, kind)).filter(f => f.endsWith(".jsonl")).sort().flatMap(f => { const p = readFileSync(join(dir, kind, f), "utf8").split("\n"); p.pop(); return p.filter(l => l.trim()).map(l => JSON.parse(l)); });
const watched = new Set(Object.keys(JSON.parse(readFileSync(watchedFile, "utf8")).names));
const osv = read("osv");
const records = osv.filter(r => r.type === "osv");
const ids = new Set(records.map(r => r.id));
const namingWatched = [...new Set(records.filter(r => (r.record?.affected ?? []).some(a => a?.package?.ecosystem === "npm" && watched.has(a.package.name))).map(r => r.id))];
const captures = read("captures").map((r, i) => ({ r, i })).sort((a, b) => Date.parse(a.r.fetched_at) - Date.parse(b.r.fetched_at) || a.i - b.i).map(x => x.r);
const previous = new Map(), repeats = {};
for (const r of captures) {
  const key = createHash("sha256").update(JSON.stringify({ ...r, fetched_at: undefined })).digest("hex"), stream = ["baseline", "change", "gone"].includes(r.type) ? `timeline\0${r.name}` : `${r.type}\0${r.name ?? r.id}\0${r.version ?? ""}`;
  if (previous.get(stream) === key) { const t = r.type === "version" ? `version:${r.reason}` : r.type; repeats[t] = (repeats[t] ?? 0) + 1; }
  previous.set(stream, key);
}
console.log(JSON.stringify({ osv_lines: osv.length, osv_records: records.length, osv_ids: ids.size, mal_ids: [...ids].filter(i => i.startsWith("MAL-")).length, osv_gave_up: osv.filter(r => r.type === "gave_up").length, ids_naming_a_watched_package: namingWatched, capture_records: captures.length, repeats_dropped: repeats }, null, 1));
