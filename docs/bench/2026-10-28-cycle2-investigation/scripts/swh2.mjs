// Public read-only: is a removed npm version present in any Software Heritage snapshot of its origin?
const keys = [["colors", "1.4.2"], ["rc", "1.3.9"], ["inquirer", "1.3.0"], ["@ensdomains/buffer", "0.1.1"]];
const api = "https://archive.softwareheritage.org/api/1";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } }); return { status: r.status, body: r.ok ? await r.json() : null, left: r.headers.get("x-ratelimit-remaining") }; };
for (const [name, version] of keys) {
  const origin = `https://www.npmjs.com/package/${name}`;
  const visits = await get(`${api}/origin/${origin}/visits/?per_page=100`);
  if (!visits.body) { console.log(name, version, "no origin", visits.status); continue; }
  let found = null, checked = 0;
  for (const v of visits.body.filter(v => v.snapshot)) {
    if (checked >= 8) break;
    checked++;
    const s = await get(`${api}/snapshot/${v.snapshot}/?branches_from=releases/${version}&branches_count=1`);
    const branches = s.body?.branches ?? {};
    if (branches[`releases/${version}`]) { found = v.date; break; }
  }
  console.log(name, version, "visits", visits.body.length, "dates", visits.body.at(-1)?.date?.slice(0, 10), "..", visits.body[0]?.date?.slice(0, 10), "checked", checked, "found in visit", found, "ratelimit left", visits.left);
}
