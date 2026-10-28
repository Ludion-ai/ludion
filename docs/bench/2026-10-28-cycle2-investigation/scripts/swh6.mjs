// Public read-only: does the first Software Heritage snapshot after each key's publish time hold the version?
import { readFileSync, writeFileSync } from "node:fs";
const prev = JSON.parse(readFileSync("/out/swh-blockers.json", "utf8"));
const api = "https://archive.softwareheritage.org/api/1";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } }); return { body: r.ok ? await r.json() : null, next: /<([^>]+)>;\s*rel="next"/.exec(r.headers.get("link") ?? "")?.[1] ?? null }; };
for (const row of prev.rows) {
  const [name, version] = [row.key.slice(0, row.key.lastIndexOf("@")), row.key.slice(row.key.lastIndexOf("@") + 1)];
  const at = Date.parse(row.published);
  const visits = [];
  let url = `${api}/origin/https://www.npmjs.com/package/${name}/visits/?per_page=100`;
  while (url) { const p = await get(url); if (!p.body) break; visits.push(...p.body); if (p.body.some(v => Date.parse(v.date) < at)) break; url = p.next; }
  const first = visits.filter(v => v.snapshot && Date.parse(v.date) >= at).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  let holds = null;
  if (first) { const s = await get(`${api}/snapshot/${first.snapshot}/?branches_from=releases/${version}&branches_count=1`); holds = !!s.body?.branches?.[`releases/${version}`]; }
  row.first_snapshot_after_publish = first ? { date: first.date, holds_version: holds } : null;
  console.log(row.key, first?.date ?? "none", holds);
}
prev.checked_first_snapshot_at = new Date().toISOString();
writeFileSync("/out/swh-blockers.json", JSON.stringify(prev, null, 1));
