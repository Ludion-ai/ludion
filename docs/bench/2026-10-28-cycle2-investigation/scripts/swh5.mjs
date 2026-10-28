// Public read-only: Software Heritage's extrinsic metadata for the archived @ensdomains/buffer 0.1.1 directory
// (the npm manifest it replicated, and the original artifact's checksums), saved as returned.
import { writeFileSync } from "node:fs";
const api = "https://archive.softwareheritage.org/api/1";
const swhid = "swh:1:dir:3d9e48db08c991644ad0eba0475ca1fbd9ecc047";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r; };
const authorities = await (await get(`${api}/raw-extrinsic-metadata/swhid/${swhid}/authorities/`)).json();
const out = { swhid, authorities, entries: [] };
for (const a of authorities) {
  const list = await (await get(a.metadata_list_url)).json();
  for (const m of list) {
    const body = await (await get(m.metadata_url)).text();
    out.entries.push({ format: m.format, discovery_date: m.discovery_date, authority: m.authority, fetcher: m.fetcher, metadata: (() => { try { return JSON.parse(body); } catch { return body; } })() });
  }
}
writeFileSync("/e/swh-0.1.1-metadata.json", JSON.stringify(out, null, 1));
for (const e of out.entries) {
  const m = e.metadata;
  if (e.format === "replicate-npm-package-json") console.log(e.format, e.discovery_date, "integrity", m?.dist?.integrity, "shasum", m?.dist?.shasum, "user", m?._npmUser?.name, "scripts", Object.keys(m?.scripts ?? {}).join(","), "deps", JSON.stringify(m?.dependencies ?? {}));
  else console.log(e.format, e.discovery_date, JSON.stringify(m).slice(0, 400));
}
