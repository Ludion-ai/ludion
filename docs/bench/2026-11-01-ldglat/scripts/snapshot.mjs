// LDGLAT: find each candidate version's first appearance in snapshot.debian.org's debian-security
// archive (decision 2026-11-01-ldglat-definitions.md, sections 3 and 4). Runs only in a container
// with no credentials. Sends only Debian source package names and versions.
// Usage: node snapshot.mjs <packages.tsv> <cache dir> <out dir>
// Writes <out>/versions.tsv (source, number of versions listed, number with deb12u),
// <out>/snapshot-files.jsonl (per candidate: the files used, with their fileinfo) and
// <out>/fixes.tsv (source, version, binary, start, start_kind, first_seen_debian, why).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";

const [pkgFile, cache, out] = process.argv.slice(2);
mkdirSync(cache, { recursive: true });
const BASE = "https://snapshot.debian.org/mr";
const log = (s) => appendFileSync(`${out}/snapshot.log`, `${new Date().toISOString()} ${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const key = `${cache}/${encodeURIComponent(path)}.json`;
  if (existsSync(key)) return JSON.parse(readFileSync(key, "utf8"));
  for (let i = 0; i < 4; i++) {
    await sleep(400 + i * 3000);
    let r;
    try { r = await fetch(BASE + path, { headers: { "user-agent": "ludion-ldglat-measurement" } }); }
    catch (e) { log(`ERR ${path} ${e.message}`); continue; }
    if (r.status === 404) { log(`404 ${path}`); writeFileSync(key, "null"); return null; }
    if (!r.ok) { log(`HTTP ${r.status} ${path}`); continue; }
    const j = await r.json();
    writeFileSync(key, JSON.stringify(j));
    return j;
  }
  log(`FAIL ${path}`);
  return undefined;
}

const rows = readFileSync(pkgFile, "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
// One binary per source: the first binary in the latest listing of a base image, else of any file.
const bin = new Map(), seen = new Map();
for (const [file, , , src, ver, b] of rows) {
  if (!seen.has(src)) seen.set(src, new Set());
  seen.get(src).add(ver);
  const base = file.startsWith("repos/debian/");
  if (b && (base || !bin.has(src) || !bin.get(src).base)) bin.set(src, { b, base });
}
const iso = (s) => s.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z");
const versions = ["source\tlisted\tdeb12u"];
const fixes = ["source\tversion\tbinary\tstart\tstart_kind\tfirst_seen_debian\twhy"];
writeFileSync(`${out}/snapshot-files.jsonl`, "");
const sources = [...seen.keys()].sort();
log(`start ${sources.length} sources`);
for (const src of sources) {
  const list = await get(`/package/${encodeURIComponent(src)}/`);
  const listed = list ? list.result.map((r) => r.version) : [];
  const deb12 = listed.filter((v) => v.includes("deb12u"));
  versions.push(list ? `${src}\t${listed.length}\t${deb12.length}` : `${src}\t${list === null ? "404" : "FAIL"}\t`);
  const cands = [...new Set([...deb12, ...seen.get(src)])].sort();
  const binary = bin.get(src)?.b || "";
  for (const v of cands) {
    let j = await get(`/package/${encodeURIComponent(src)}/${encodeURIComponent(v)}/allfiles?fileinfo=1`);
    // snapshot answers 404 to allfiles when it indexes no binary of the version; the source's
    // .dsc is then the start (decision section 4), read from srcfiles.
    if (j === null) {
      const s = await get(`/package/${encodeURIComponent(src)}/${encodeURIComponent(v)}/srcfiles?fileinfo=1`);
      if (s) j = { result: { source: s.result, binaries: [] }, fileinfo: s.fileinfo, srcOnly: true };
      log(`allfiles-404 ${src} ${v} srcfiles ${s ? "ok" : s === null ? "404" : "fail"}`);
    }
    if (!j) { fixes.push([src, v, binary, "", "", "", j === null ? "allfiles-404" : "allfiles-fail"].join("\t")); continue; }
    const info = j.fileinfo || {};
    const used = [];
    const firstIn = (hashes, archive) => {
      let m = null;
      for (const h of hashes) for (const f of info[h] || []) if (f.archive_name === archive && (!m || f.first_seen < m)) m = f.first_seen;
      return m;
    };
    const b = (j.result.binaries || []).filter((x) => x.name === binary);
    const bh = [];
    for (const x of b) for (const f of x.files || []) if (f.architecture === "amd64" || f.architecture === "all") { bh.push(f.hash); used.push({ kind: "bin", name: x.name, version: x.version, arch: f.architecture, hash: f.hash, fileinfo: info[f.hash] || [] }); }
    const sh = [];
    for (const f of j.result.source || []) {
      const names = (info[f.hash] || []).map((i) => i.name);
      if (names.some((n) => n.endsWith(".dsc"))) { sh.push(f.hash); used.push({ kind: "dsc", hash: f.hash, fileinfo: info[f.hash] || [] }); }
    }
    appendFileSync(`${out}/snapshot-files.jsonl`, JSON.stringify({ source: src, version: v, binary, used }) + "\n");
    let start = firstIn(bh, "debian-security"), kind = "bin";
    if (!start) { start = firstIn(sh, "debian-security"); kind = "src"; }
    const deb = firstIn(bh.length ? bh : sh, "debian");
    if (!start) { fixes.push([src, v, binary, "", "", deb ? iso(deb) : "", bh.length ? "not-in-debian-security" : "no-binary-and-not-in-debian-security"].join("\t")); continue; }
    fixes.push([src, v, binary, iso(start), kind, deb ? iso(deb) : "", ""].join("\t"));
  }
  log(`done ${src} ${cands.length} candidates`);
}
writeFileSync(`${out}/versions.tsv`, versions.join("\n") + "\n");
writeFileSync(`${out}/fixes.tsv`, fixes.join("\n") + "\n");
log("finished");
