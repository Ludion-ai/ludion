// node package.mjs <osv dir> <impact.ts> <name>: every npm record that names the package, with its id, aliases, CWEs,
// withdrawn time, summary and class now, one per line (tab-separated). For ua-parser-js, which the chat named.
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath, name] = process.argv.slice(2);
const { classify } = await import(impactPath);
console.log(["id", "aliases", "cwes", "withdrawn", "class", "summary"].join("\t"));
for (const [, text] of entries(join(dir, "npm.zip"))) {
  const r = JSON.parse(text);
  if (!(Array.isArray(r.affected) ? r.affected : []).some(a => a?.package?.name === name)) continue;
  const c = classify(r);
  console.log([r.id, (r.aliases ?? []).join(",") || "-", c.cwes.join(",") || "-", r.withdrawn ?? "-", c.class, JSON.stringify(r.summary ?? "")].join("\t"));
}
