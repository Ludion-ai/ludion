// node pick-trap.mjs <osv dir>: the real OSV records kept as test fixtures for the trap paths LMR1b added, printed as
// one JSON array. Per ecosystem, GHSA records sorted by id: the first 2 with a MAL- alias, and the first 2 that list
// CWE-506 and have no MAL- alias. Chosen from the records' own fields, not by classify().
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir] = process.argv.slice(2);
const picked = [];
for (const ecosystem of ["npm", "Packagist"]) {
  const records = [];
  for (const [, text] of entries(join(dir, `${ecosystem}.zip`))) {
    const r = JSON.parse(text);
    if (/^GHSA-/.test(r.id)) records.push(r);
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const alias = r => Array.isArray(r.aliases) && r.aliases.some(a => typeof a === "string" && a.startsWith("MAL-"));
  const cwe506 = r => Array.isArray(r.database_specific?.cwe_ids) && r.database_specific.cwe_ids.includes("CWE-506");
  const withAlias = records.filter(alias).slice(0, 2);
  const with506 = records.filter(r => cwe506(r) && !alias(r)).slice(0, 2);
  console.error(`${ecosystem}: ${records.filter(alias).length} GHSA records with a MAL- alias, ${records.filter(r => cwe506(r) && !alias(r)).length} with CWE-506 and no MAL- alias`);
  picked.push(...withAlias, ...with506);
}
console.log(JSON.stringify(picked, null, 2));
