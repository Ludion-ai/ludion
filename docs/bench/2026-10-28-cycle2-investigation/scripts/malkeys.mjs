// Which unreadable removed versions are themselves named by OSV MAL- records (names and versions only are sent),
// and how many unknown versions would clear if every such malicious key, or every removed key, became readable.
import { readFileSync, writeFileSync } from "node:fs";
const d = JSON.parse(readFileSync("/d/diag-unknown.json", "utf8"));
const removed = Object.entries(d.keys).filter(([, k]) => k === "version removed (time kept)").map(([k]) => k);
const split = key => { const at = key.lastIndexOf("@"); return [key.slice(0, at), key.slice(at + 1)]; };
const res = await fetch("https://api.osv.dev/v1/querybatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queries: removed.map(k => { const [name, version] = split(k); return { package: { ecosystem: "npm", name }, version }; }) }) });
const body = await res.json();
const mal = new Map();
body.results.forEach((r, i) => { const ids = (r.vulns ?? []).map(v => v.id).filter(id => id.startsWith("MAL-")); if (ids.length) mal.set(removed[i], ids); });
const kind = d.keys;
const readable = { "every removed malicious key": k => mal.has(k), "every removed key": k => kind[k] === "version removed (time kept)", "every removed key and unverified check": k => kind[k] === "version removed (time kept)" || kind[k] === "same-release check unverified" };
const per = {};
for (const [u, v] of Object.entries(d.per_urgency)) per[u] = Object.fromEntries(Object.entries(readable).map(([s, f]) => [s, v.rows.filter(r => r.keys.every(f)).length]));
const out = { checked_at: new Date().toISOString(), removed_keys: removed.length, malicious_removed_keys: Object.fromEntries(mal), cleared_if_readable: per };
writeFileSync("/d/malkeys.json", JSON.stringify(out, null, 1));
console.log(mal.size, JSON.stringify([...mal.keys()]));
console.log(JSON.stringify(per, null, 1));
