// Sizes of the PC recorder's data directory, read only: bytes and counts per record type and day, capture bytes per
// hour, and poll durations. Run with the data directory as the argument:
//   node docs/bench/2026-10-29-shadow-actions/scripts/measure-pc.mjs C:/dev/ludion-shadow-data/data
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const out = {};
for (const sub of ["captures", "osv", "status"]) {
  for (const f of readdirSync(join(dir, sub))) {
    const lines = readFileSync(join(dir, sub, f), "utf8").split("\n").filter(Boolean);
    for (const l of lines) {
      const r = JSON.parse(l);
      const k = `${sub}/${f.slice(0,10)}/${r.type}${r.reason ? ":" + r.reason : ""}`;
      out[k] ??= { n: 0, bytes: 0 };
      out[k].n++; out[k].bytes += Buffer.byteLength(l) + 1;
    }
  }
}
console.log(JSON.stringify(out, null, 1));
// per-hour capture bytes
const hours = {};
for (const f of readdirSync(join(dir, "captures"))) for (const l of readFileSync(join(dir, "captures", f), "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(l); const h = (r.fetched_at ?? "").slice(0, 13); hours[h] = (hours[h] ?? 0) + Buffer.byteLength(l) + 1;
}
console.log(JSON.stringify(hours));
const polls = [];
for (const f of readdirSync(join(dir, "status"))) for (const l of readFileSync(join(dir, "status", f), "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); if (r.type === "poll") polls.push(r); }
const ms = polls.map(p => p.ms).sort((a, b) => a - b);
const q = p => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
console.log({ polls: polls.length, first: polls[0]?.at, last: polls.at(-1)?.at, ms_median: q(0.5), ms_p90: q(0.9), ms_p99: q(0.99), ms_max: ms.at(-1), ms_sum: ms.reduce((a, b) => a + b, 0), entries_sum: polls.reduce((a, p) => a + p.entries, 0), watched_sum: polls.reduce((a, p) => a + p.watched, 0) });
