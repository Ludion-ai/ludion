// node pick.mjs <osv dir> <impact.ts>: the real OSV records kept as test fixtures, printed as one JSON array.
// Per ecosystem, records sorted by id: the first 2 of each class (unclassified: 2 without a CWE and 2 with), and the
// first 2 whose CWEs are in two or more classes. GitHub's GHSA and OpenSSF's MAL- records only (their licences are
// named in the fixture's README); Drupal's records are left out.
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath] = process.argv.slice(2);
const { classify, CWE_CLASSES } = await import(impactPath);
const classOf = new Map(Object.entries(CWE_CLASSES).flatMap(([c, ids]) => ids.map(id => [`CWE-${id}`, c])));
const picked = [];
for (const ecosystem of ["npm", "Packagist"]) {
  const records = [];
  for (const [, text] of entries(join(dir, `${ecosystem}.zip`))) {
    const r = JSON.parse(text);
    if (/^(GHSA|MAL)-/.test(r.id)) records.push(r);
  }
  records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const taken = new Map();
  const take = (key, r) => {
    if ((taken.get(key) ?? 0) >= 2) return false;
    taken.set(key, (taken.get(key) ?? 0) + 1);
    picked.push(r);
    return true;
  };
  for (const r of records) {
    const c = classify(r);
    const key = c.class === "unclassified" ? (c.cwes.length ? "unclassified-cwe" : "unclassified-none") : c.class;
    if (take(key, r)) continue;
    if (new Set(c.cwes.map(x => classOf.get(x)).filter(Boolean)).size >= 2) take("several", r);
  }
}
console.log(JSON.stringify(picked, null, 2));
