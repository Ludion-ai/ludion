// Public read-only estimate: for every malicious version that is unknown at some wait in backtest v4, does ecosyste.ms
// hold its metadata, and does it declare an install script that its prev did not (prev from the registry cache, else
// ecosyste.ms)? In v4's outcome rule another gate 2 stop comes before "unknown". This is not a run: nothing is judged.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const v4 = JSON.parse(readFileSync("/d/malicious-v4.json", "utf8"));
const U = ["exploited", "high", "normal", "low"];
const unknown = v4.rows.filter(r => U.some(u => r.with_exception.outcomes[u].conservative.primary === "unknown"));
const LIFE = ["preinstall", "install", "postinstall"];
const eco = async (name, version) => {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`, { headers: { "user-agent": "ludion-research (read-only)" } });
      if (res.status === 429 || res.status >= 500) { await new Promise(s => setTimeout(s, 3000 * (i + 1))); continue; }
      if (!res.ok) return { status: res.status };
      const j = await res.json();
      const meta = j.metadata && Object.keys(j.metadata).length ? j.metadata : null;
      return { status: 200, metadata: !!meta, scripts: meta ? LIFE.filter(s => typeof meta.scripts?.[s] === "string") : null, publisher: meta?._npmUser?.name ?? null };
    } catch { await new Promise(s => setTimeout(s, 2000)); }
  }
  return { status: "error" };
};
const cached = name => { const f = `/cache/registry/${encodeURIComponent(name)}.json`; return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
const out = [];
for (const r of unknown) {
  const v = await eco(r.name, r.version);
  const doc = cached(r.name);
  let prevScripts = null, prevSource = null;
  if (doc?.versions?.[r.previous]) { prevScripts = doc.versions[r.previous].s ? "some" : []; prevSource = "registry cache"; }
  else { const p = await eco(r.name, r.previous); if (p.metadata) { prevScripts = p.scripts; prevSource = "ecosyste.ms"; } }
  // The registry cache keeps only whether a version has install scripts ("s"), not which; "some" means at least one.
  const added = v.metadata && prevScripts !== null ? (Array.isArray(prevScripts) ? v.scripts.some(s => !prevScripts.includes(s)) : null) : null;
  out.push({ key: `${r.name}@${r.version}`, prev: r.previous, unknown_at: U.filter(u => r.with_exception.outcomes[u].conservative.primary === "unknown"), v_metadata: !!v.metadata, v_scripts: v.scripts ?? null, prev_scripts: prevScripts, prev_source: prevSource, scripts_added: added });
}
const by = u => { const rows = out.filter(o => o.unknown_at.includes(u)); return { unknown: rows.length, v_metadata: rows.filter(o => o.v_metadata).length, scripts_added: rows.filter(o => o.scripts_added === true).length, undetermined: rows.filter(o => o.scripts_added === null).length }; };
const summary = Object.fromEntries(U.map(u => [u, by(u)]));
writeFileSync("/out/unknown-scripts.json", JSON.stringify({ checked_at: new Date().toISOString(), note: "Estimate only; not a backtest run.", summary, rows: out }, null, 1));
console.log(JSON.stringify(summary, null, 1));
