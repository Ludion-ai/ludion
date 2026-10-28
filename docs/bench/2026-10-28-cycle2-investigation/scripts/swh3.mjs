// Public read-only: Software Heritage's archived @ensdomains/buffer 0.1.1 (visit 2023-03-23), its file list and
// sha256 per file, compared with jsDelivr's listing (sha256, base64). Nothing is downloaded but metadata.
import { readFileSync, writeFileSync } from "node:fs";
const api = "https://archive.softwareheritage.org/api/1";
const get = async u => { const r = await fetch(u, { headers: { "user-agent": "ludion-research (read-only)" } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };
const snap = await get(`${api}/snapshot/109911d09c488cce170773a0d8191016b80ddff1/?branches_from=releases/0.1.1&branches_count=1`);
const branch = snap.branches["releases/0.1.1"];
console.log("branch", JSON.stringify(branch));
let target = branch.target, type = branch.target_type, meta = null;
if (type === "release") { const rel = await get(`${api}/release/${target}/`); meta = { name: rel.name, message: rel.message, date: rel.date, author: rel.author?.fullname ?? null, target_type: rel.target_type }; target = rel.target; type = rel.target_type; }
if (type === "revision") { const rev = await get(`${api}/revision/${target}/`); meta = { ...meta, rev_message: rev.message, rev_date: rev.date, metadata: rev.metadata ?? null }; target = rev.directory; type = "directory"; }
console.log("meta", JSON.stringify(meta).slice(0, 800));
const files = new Map();
async function walk(dir, prefix) {
  for (const e of await get(`${api}/directory/${dir}/`)) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.type === "dir") await walk(e.target, p);
    else files.set(p, { length: e.length, sha256: e.checksums?.sha256 ?? null });
  }
}
await walk(target, "");
// The archive may keep the tarball's top folder ("package/").
const strip = [...files.keys()].every(p => p.startsWith("package/"));
const swh = new Map([...files].map(([p, v]) => [strip ? p.slice(8) : p, v]));
const flat = (l, pre = "", out = new Map()) => { for (const f of l.files) { const p = pre ? `${pre}/${f.name}` : f.name; if (f.type === "directory") flat(f, p, out); else out.set(p, { size: f.size, sha256: Buffer.from(f.hash, "base64").toString("hex") }); } return out; };
const jsd = flat(JSON.parse(readFileSync("/e/raw/jsdelivr-0.1.1-list.json", "utf8")));
const same = [...jsd].filter(([p, v]) => swh.get(p)?.sha256 === v.sha256).length;
const result = { swh_files: swh.size, jsdelivr_files: jsd.size, identical_sha256: same, only_swh: [...swh.keys()].filter(p => !jsd.has(p)), only_jsdelivr: [...jsd.keys()].filter(p => !swh.has(p)), differing: [...jsd.keys()].filter(p => swh.has(p) && swh.get(p).sha256 !== jsd.get(p).sha256), meta };
writeFileSync("/e/swh-0.1.1.json", JSON.stringify(result, null, 1));
console.log(JSON.stringify(result).slice(0, 1500));
