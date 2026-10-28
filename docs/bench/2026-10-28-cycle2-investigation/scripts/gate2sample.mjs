// Public read-only: of the removed malicious versions in backtest v4's denominator (present: false), a fixed sample of
// 50 (every n-th in file order), how many does ecosyste.ms hold with metadata (publisher, scripts, dependencies)?
import { readFileSync, writeFileSync } from "node:fs";
const v4 = JSON.parse(readFileSync("/d/malicious-v4.json", "utf8"));
const removed = v4.rows.filter(r => !r.present);
const step = Math.floor(removed.length / 50);
const sample = Array.from({ length: 50 }, (_, i) => removed[i * step]);
const out = [];
for (const r of sample) {
  let status = "error", metadata = false, scripts = null, publisher = null, prev = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${encodeURIComponent(r.name)}/versions/${encodeURIComponent(r.version)}`, { headers: { "user-agent": "ludion-research (read-only)" } });
      status = res.status;
      if (res.status === 429 || res.status >= 500) { await new Promise(s => setTimeout(s, 3000 * (i + 1))); continue; }
      if (res.ok) { const j = await res.json(); metadata = !!(j.metadata && Object.keys(j.metadata).length); scripts = j.metadata?.scripts ? Object.keys(j.metadata.scripts).filter(s => ["preinstall", "install", "postinstall"].includes(s)) : null; publisher = j.metadata?._npmUser?.name ?? null; }
      break;
    } catch { await new Promise(s => setTimeout(s, 2000)); }
  }
  out.push({ key: `${r.name}@${r.version}`, published: r.published, status, metadata, install_scripts: scripts, publisher });
}
const withMeta = out.filter(o => o.metadata).length;
writeFileSync("/out/gate2-sample.json", JSON.stringify({ checked_at: new Date().toISOString(), removed: removed.length, sample: out.length, step, with_metadata: withMeta, rows: out }, null, 1));
console.log("removed", removed.length, "sample", out.length, "ecosyste.ms with metadata", withMeta, "status 200", out.filter(o => o.status === 200).length);
console.log(out.filter(o => o.metadata).map(o => `${o.key} ${o.published.slice(0, 10)} scripts=${JSON.stringify(o.install_scripts)}`).join("\n"));
