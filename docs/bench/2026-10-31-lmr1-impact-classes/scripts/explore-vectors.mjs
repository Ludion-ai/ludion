// node explore-vectors.mjs <zip>...: the shapes of the CVSS vectors in OSV's severity field, read before LMR1c's vector
// rule was written: each type, how many records give which types, the version prefixes and the metric keys seen, and
// how many vectors repeat a metric or lack C/I/A (VC/VI/VA/SC/SI/SA for v4). No record is classified.
import { entries } from "./zip.mjs";

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const types = new Map(), combos = new Map(), prefixes = new Map(), keys = new Map(), odd = new Map(), notArray = new Map();
let records = 0;
const need = { CVSS_V2: ["C", "I", "A"], CVSS_V3: ["C", "I", "A"], CVSS_V4: ["VC", "VI", "VA", "SC", "SI", "SA"] };
for (const path of process.argv.slice(2)) {
  const zip = path.split("/").pop();
  for (const [, text] of entries(path)) {
    const r = JSON.parse(text);
    records++;
    if (r.severity !== undefined && !Array.isArray(r.severity)) bump(notArray, `${zip} ${typeof r.severity}`);
    const list = Array.isArray(r.severity) ? r.severity : [];
    bump(combos, `${zip} ${list.map(s => s?.type).join("+") || "(none)"}`);
    for (const s of list) {
      bump(types, `${zip} ${s?.type}`);
      const score = typeof s?.score === "string" ? s.score : "";
      bump(prefixes, `${s?.type} ${score.split("/")[0]}`);
      const parts = score.split("/").slice(score.startsWith("CVSS:") ? 1 : 0).map(p => p.split(":"));
      const seen = new Map();
      for (const [k, v] of parts) { bump(keys, `${s?.type} ${k}=${v}`); bump(seen, k); }
      for (const k of need[s?.type] ?? []) if (seen.get(k) !== 1) bump(odd, `${s?.type} ${k} appears ${seen.get(k) ?? 0} times`);
      if ([...seen.values()].some(n => n > 1)) bump(odd, `${s?.type} some metric repeated`);
    }
  }
}
console.log(JSON.stringify({ records, notArray: [...notArray], types: [...types], combos: [...combos].sort((a, b) => b[1] - a[1]), prefixes: [...prefixes], odd: [...odd] }, null, 1));
for (const [k, n] of [...keys].sort()) console.log(n, k);
