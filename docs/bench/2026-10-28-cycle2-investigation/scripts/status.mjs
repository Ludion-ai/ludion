// Public read-only: HTTP statuses behind the README's "removed / not mirrored" statements, and every OSV id (any prefix)
// for the keys behind the most unknowns. Bodies are not kept except OSV's id lists.
import { writeFileSync } from "node:fs";
const urls = [
  "https://registry.npmjs.org/@ensdomains/buffer/-/buffer-0.1.1.tgz",
  "https://registry.npmjs.org/@ensdomains%2fbuffer/0.1.1",
  "https://api.deps.dev/v3/systems/npm/packages/%40ensdomains%2Fbuffer/versions/0.1.1",
  "https://registry.npmmirror.com/@ensdomains/buffer/0.1.1",
  "https://registry.npmmirror.com/@ensdomains/buffer/-/buffer-0.1.1.tgz",
  "https://registry.yarnpkg.com/@ensdomains/buffer/-/buffer-0.1.1.tgz",
  "https://unpkg.com/@ensdomains/buffer@0.1.1/package.json",
  "https://web.archive.org/cdx/search/cdx?url=registry.npmjs.org/@ensdomains/buffer&output=json&limit=50",
  "https://web.archive.org/cdx/search/cdx?url=registry.npmjs.org/@ensdomains%2fbuffer&output=json&limit=50",
];
const statuses = [];
for (const u of urls) {
  try { const r = await fetch(u, { redirect: "follow", headers: { "user-agent": "ludion-research (read-only)" } }); const t = await r.text(); statuses.push({ url: u, status: r.status, final_url: r.url, bytes: t.length, body_if_small: t.length <= 64 ? t : undefined }); }
  catch (e) { statuses.push({ url: u, status: "error", error: String(e) }); }
}
const keys = [["rc", "1.3.9"], ["pinkie", "2.0.5"], ["device-detector-js", "3.11.4"], ["error-ex", "1.3.3"], ["colors", "1.4.2"], ["coa", "2.1.3"], ["is-extglob", "1.1.3"]];
const q = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: keys.map(([name, version]) => ({ package: { ecosystem: "npm", name }, version })) }) });
const body = await q.json();
const osv = keys.map(([name, version], i) => ({ key: `${name}@${version}`, ids: (body.results[i].vulns ?? []).map(v => v.id) }));
writeFileSync("/out/status-and-osv.json", JSON.stringify({ checked_at: new Date().toISOString(), statuses, osv_ids_for_top_keys: osv }, null, 1));
for (const s of statuses) console.log(s.status, s.url, s.body_if_small ?? "");
for (const o of osv) console.log(o.key, JSON.stringify(o.ids));
