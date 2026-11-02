// Inside the container only. For each GH Archive hour given, prints the file's size and its count of events per type. Keeps nothing.
// usage: node probe-types.mjs <YYYY-MM-DD-H> ...
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

for (const hour of process.argv.slice(2)) {
  if (!/^\d{4}-\d{2}-\d{2}-\d{1,2}$/.test(hour)) throw new Error("hour");
  const res = await fetch(`https://data.gharchive.org/${hour}.json.gz`);
  if (!res.ok) { console.log(JSON.stringify({ hour, status: res.status })); await res.body?.cancel(); continue; }
  const types = {};
  let lines = 0;
  const rl = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;
    const m = /"type":"([A-Za-z]+Event)"/.exec(line);
    const t = m ? m[1] : "other";
    types[t] = (types[t] ?? 0) + 1;
  }
  console.log(JSON.stringify({ hour, bytes: Number(res.headers.get("content-length")), lines, PushEvent: types.PushEvent ?? 0, CreateEvent: types.CreateEvent ?? 0, PullRequestEvent: types.PullRequestEvent ?? 0, WatchEvent: types.WatchEvent ?? 0, ForkEvent: types.ForkEvent ?? 0 }));
}
