// Public read-only: for the keys behind the most unknowns, is the removed version in a Software Heritage snapshot taken
// within 60 days after its publish time (read from the v4 registry cache)?
import { readFileSync, writeFileSync } from "node:fs";
const keys = [["rc", "1.3.9"], ["pinkie", "2.0.5"], ["device-detector-js", "3.11.4"], ["error-ex", "1.3.3"], ["colors", "1.4.2"], ["coa", "2.1.3"], ["is-extglob", "1.1.3"]];
const api = "https://archive.softwareheritage.org/api/1";
let left = null;
const get = async u => { const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } }); left = r.headers.get("x-ratelimit-remaining"); return r.ok ? r.json() : null; };
const out = [];
for (const [name, version] of keys) {
  const doc = JSON.parse(readFileSync(`/cache/registry/${encodeURIComponent(name)}.json`, "utf8"));
  const published = doc?.time?.[version] ?? null;
  const visits = (await get(`${api}/origin/https://www.npmjs.com/package/${name}/visits/?per_page=100`)) ?? [];
  const at = Date.parse(published);
  const near = visits.filter(v => v.snapshot && Date.parse(v.date) >= at && Date.parse(v.date) <= at + 60 * 86_400_000).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(0, 3);
  let found = null;
  for (const v of near) {
    const s = await get(`${api}/snapshot/${v.snapshot}/?branches_from=releases/${version}&branches_count=1`);
    if (s?.branches?.[`releases/${version}`]) { found = v.date; break; }
  }
  const oldest = visits.length ? visits.map(v => v.date).sort()[0] : null;
  out.push({ key: `${name}@${version}`, published, visits: visits.length, oldest_visit_listed: oldest, visits_within_60_days: near.map(v => v.date), found_in: found });
  console.log(`${name}@${version}`, published, "visits", visits.length, "oldest", oldest?.slice(0, 10), "near", near.length, "found", found, "left", left);
}
writeFileSync("/out/swh-blockers.json", JSON.stringify(out, null, 1));
