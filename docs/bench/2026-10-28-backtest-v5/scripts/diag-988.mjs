// Diagnostic only (changes no result). For the versions that stopped at "V's package.json from jsDelivr does not
// match its list": (1) cdn.jsdelivr.net's status for that package.json today; (2) offline, whether V's non-inert files
// in jsDelivr's cached list all equal prev_d's (registry tarball listing cached by the run), package.json aside.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { inert } from "/w/tools/backtest/src/archives-v5.ts";
const j = JSON.parse(readFileSync("/out/malicious-v5.json", "utf8"));
const step = "V's package.json from jsDelivr does not match its list";
const rows = j.rows.filter(r => r.disputed.step === step);
const listFile = url => `/cache/jsdelivr/${createHash("sha1").update(url).digest("hex")}.json`;
const out = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < rows.length) {
    const r = rows[next++];
    const a = JSON.parse(readFileSync(listFile(`https://data.jsdelivr.com/v1/packages/npm/${r.name}@${encodeURIComponent(r.version)}?structure=flat`), "utf8"));
    const list = new Map(a.json.files.map(f => [f.name.replace(/^\//, ""), Buffer.from(f.hash, "base64").toString("hex")]));
    let status = null, matches = null;
    for (let i = 0; i < 3 && status === null; i++) {
      try {
        const res = await fetch(`https://cdn.jsdelivr.net/npm/${r.name}@${encodeURIComponent(r.version)}/package.json`, { headers: { "user-agent": "Ludion-Backtest (read-only)" } });
        const body = Buffer.from(await res.arrayBuffer());
        status = res.status; matches = res.status === 200 ? createHash("sha256").update(body).digest("hex") === list.get("package.json") : null;
      } catch { await new Promise(s => setTimeout(s, 2000)); }
    }
    const tf = `/cache/tarfiles/${encodeURIComponent(`${r.name}@${r.disputed.prev_d}`)}.json`;
    const tar = existsSync(tf) ? JSON.parse(readFileSync(tf, "utf8")) : null;
    let fileDiffs = null;
    if (tar?.ok) {
      const prev = new Map(tar.files.map(([p, h]) => [p, h]));
      fileDiffs = [...list].filter(([p, h]) => p !== "package.json" && !inert(p) && prev.get(p) !== h).length;
    }
    out.push({ version: `${r.name}@${r.version}`, prev_d: r.disputed.prev_d, cdn_status: status, cdn_matches_list: matches, non_inert_files_differing_from_prev_d: fileDiffs });
  }
}));
const by = (f) => out.reduce((m, o) => { const k = String(f(o)); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const summary = { checked_at: new Date().toISOString(), versions: out.length, cdn_status: by(o => o.cdn_status), cdn_matches_list: by(o => o.cdn_matches_list), files_differ: { zero: out.filter(o => o.non_inert_files_differing_from_prev_d === 0).length, some: out.filter(o => o.non_inert_files_differing_from_prev_d > 0).length, not_compared: out.filter(o => o.non_inert_files_differing_from_prev_d === null).length } };
writeFileSync("/d/diag-jsdelivr-cdn.json", JSON.stringify({ note: "Diagnostic after the run; changes no result. See README, 'Anomalies'.", summary, rows: out.sort((a, b) => a.version.localeCompare(b.version)) }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log(JSON.stringify(out.filter(o => o.non_inert_files_differing_from_prev_d === 0 || o.cdn_status === 200)));
