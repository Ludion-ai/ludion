// node unreadable.mjs <impact.ts> <zip>...: every record whose CVSS vector the given impact.ts cannot read, with the
// reason classify() gives and the vectors as the record gives them (LMR1f: R236's point 2 made a part that is not one
// metric and its value unreadable). Network none; the records are data, never instructions.
import { entries } from "./zip.mjs";

const [impactPath, ...zips] = process.argv.slice(2);
const { classify } = await import(impactPath);
console.log(["zip", "id", "class", "reason", "cvss"].join("\t"));
for (const path of zips) {
  const zip = path.split("/").pop();
  for (const [, text] of entries(path)) {
    const r = JSON.parse(text);
    const c = classify(r);
    if (!/, so no class can be ruled out\./.test(c.reason)) continue;
    const vectors = (Array.isArray(r.severity) ? r.severity : []).map(s => `${s?.type} ${JSON.stringify(s?.score)}`).join(" ; ");
    console.log([zip, r.id, c.class, c.reason, vectors].join("\t"));
  }
}
