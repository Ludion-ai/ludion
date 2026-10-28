// Public read-only: for the keys behind the most unknowns, is the removed version in a Software Heritage snapshot taken
// within 60 days after its publish time (read from the v4 registry cache)? Visits are read page by page (rel="next")
// until a page reaches back before the publish time.
import { readFileSync, writeFileSync } from "node:fs";
const keys = [["rc", "1.3.9"], ["pinkie", "2.0.5"], ["device-detector-js", "3.11.4"], ["error-ex", "1.3.3"], ["colors", "1.4.2"], ["coa", "2.1.3"], ["is-extglob", "1.1.3"]];
const api = "https://archive.softwareheritage.org/api/1";
let left = null;
const get = async u => { const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } }); left = r.headers.get("x-ratelimit-remaining"); return { body: r.ok ? await r.json() : null, next: /<([^>]+)>;\s*rel="next"/.exec(r.headers.get("link") ?? "")?.[1] ?? null, status: r.status }; };
const out = [];
for (const [name, version] of keys) {
  const doc = JSON.parse(readFileSync(`/cache/registry/${encodeURIComponent(name)}.json`, "utf8"));
  const published = doc?.time?.[version] ?? null;
  const at = Date.parse(published);
  const visits = [];
  let url = `${api}/origin/https://www.npmjs.com/package/${name}/visits/?per_page=100`, pages = 0;
  while (url) {
    const page = await get(url);
    pages++;
    if (!page.body) break;
    visits.push(...page.body);
    if (page.body.some(v => Date.parse(v.date) < at)) break;
    url = page.next;
  }
  const near = visits.filter(v => v.snapshot && Date.parse(v.date) >= at && Date.parse(v.date) <= at + 60 * 86_400_000).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).slice(0, 3);
  let found = null;
  for (const v of near) {
    const s = await get(`${api}/snapshot/${v.snapshot}/?branches_from=releases/${version}&branches_count=1`);
    if (s.body?.branches?.[`releases/${version}`]) { found = v.date; break; }
  }
  const dates = visits.map(v => v.date).sort();
  out.push({ key: `${name}@${version}`, published, pages, visits_read: visits.length, first_visit: dates[0] ?? null, visits_within_60_days: near.map(v => v.date), found_in: found });
  console.log(`${name}@${version}`, published, "pages", pages, "visits", visits.length, "first", dates[0]?.slice(0, 10), "near", near.length, "found", found, "left", left);
}
writeFileSync("/out/swh-blockers.json", JSON.stringify({ checked_at: new Date().toISOString(), rows: out }, null, 1));
