// Inside the container only. The repository id at about 2025-11-01 00:00 UTC. A ForkEvent's payload.forkee is a repository made
// at that moment, with its own id and created_at. Prints those ids' quantiles for one GH Archive hour. Keeps nothing.
// usage: node boundary.mjs <YYYY-MM-DD-H>
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const hour = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}-\d{1,2}$/.test(hour)) throw new Error("hour");
const res = await fetch(`https://data.gharchive.org/${hour}.json.gz`);
if (!res.ok) throw new Error(`status ${res.status}`);
const forks = [];
let pushIdsMax = 0;
const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of rl) {
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.type === "ForkEvent" && Number.isInteger(e.payload?.forkee?.id)) forks.push({ id: e.payload.forkee.id, created_at: e.payload.forkee.created_at, event_at: e.created_at });
  if (e.type === "PushEvent" && e.repo?.id > pushIdsMax) pushIdsMax = e.repo.id;
}
forks.sort((a, b) => a.id - b.id);
const q = f => forks[Math.floor((forks.length - 1) * f)];
const at = forks.map(f => f.created_at).sort();
console.log(JSON.stringify({ hour, forkees: forks.length, id_min: q(0), id_p01: q(0.01), id_median: q(0.5), id_p99: q(0.99), id_max: q(1), created_at_first: at[0], created_at_last: at.at(-1), largest_repo_id_in_a_push_of_the_hour: pushIdsMax }, null, 1));
