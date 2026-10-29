// L1d (docs/decisions/2026-10-29-l1d-third-sample.md, section 2): the repositories and owners (case-insensitive) the
// third sample shares with the original 100 (and JakeWharton/jakewharton.com) and with the second 100. Both must be 0.
// Reads committed files only. Usage, in Docker: node disjoint.mjs <bench dir> <third noise.json> <out file>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [bench, thirdFile, out] = process.argv.slice(2);
const rows = file => JSON.parse(readFileSync(file, "utf8")).rows.map(r => r.repo);
const original = [...rows(join(bench, "2026-10-28-noise/noise.json")), "JakeWharton/jakewharton.com"];
const second = rows(join(bench, "2026-10-29-l1c/result-new/noise.json"));
const third = rows(thirdFile);
const owner = r => r.split("/")[0].toLowerCase();
const shared = (a, b) => ({
  repositories: a.filter(r => b.some(s => s.toLowerCase() === r.toLowerCase())),
  owners: [...new Set(a.map(owner))].filter(o => b.some(s => owner(s) === o)),
});
const result = { third: third.length, original: original.length, second: second.length, with_original: shared(third, original), with_second: shared(third, second) };
result.disjoint = [result.with_original, result.with_second].every(s => s.repositories.length === 0 && s.owners.length === 0);
writeFileSync(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
