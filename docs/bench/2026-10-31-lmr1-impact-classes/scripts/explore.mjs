// node explore.mjs <zip>...: every CWE id in database_specific.cwe_ids with its record count, and the shapes seen.
import { entries } from "./zip.mjs";

const cwes = new Map(), prefixes = new Map(), severities = new Map();
let records = 0, withCwe = 0;
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
for (const path of process.argv.slice(2)) {
  for (const [, text] of entries(path)) {
    const r = JSON.parse(text);
    records++;
    bump(prefixes, `${path.split("/").pop()} ${r.id.split("-")[0]}`);
    const ids = r.database_specific?.cwe_ids;
    if (Array.isArray(ids) && ids.length) withCwe++;
    for (const id of Array.isArray(ids) ? ids : []) bump(cwes, String(id));
    bump(severities, String(r.database_specific?.severity));
  }
}
console.log(JSON.stringify({ records, withCwe, prefixes: [...prefixes], severities: [...severities] }));
for (const [id, n] of [...cwes].sort((a, b) => b[1] - a[1])) console.log(n, id);
