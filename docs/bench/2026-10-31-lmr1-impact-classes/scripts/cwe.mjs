// node cwe.mjs <dir> <impact.ts>: download MITRE's CWE list and print, for TRAP_CWES and every CWE in impact.ts's table or its
// decided-unclassified list, its class or set of classes there, abstraction, name and description, one per line (tab-separated).
// So each entry of the table can be checked against the definition it was decided by.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { entries } from "./zip.mjs";

const [dir, impactPath] = process.argv.slice(2);
const { CWE_CLASSES, DECIDED_UNCLASSIFIED, TRAP_CWES } = await import(impactPath);
const url = "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip";
const fetched_at = new Date().toISOString();
const response = await fetch(url, { redirect: "error" });
if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
writeFileSync(join(dir, "cwec.zip"), bytes);
console.log(`# ${url} fetched ${fetched_at}, ${bytes.length} bytes, sha256 ${createHash("sha256").update(bytes).digest("hex")}`);

const unescape = s => s.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const defs = new Map();
for (const [name, xml] of entries(join(dir, "cwec.zip"))) {
  const version = /<Weakness_Catalog[^>]*Version="([^"]+)"[^>]*Date="([^"]+)"/.exec(xml);
  console.log(`# ${name}: CWE version ${version?.[1]}, ${version?.[2]}`);
  for (const m of xml.matchAll(/<(Weakness|Category|View) ID="(\d+)" Name="([^"]*)"(?: Abstraction="([^"]*)")?[^>]*>([\s\S]*?)<\/\1>/g)) {
    const description = /<(?:Description|Summary)>([\s\S]*?)<\/(?:Description|Summary)>/.exec(m[5]);
    defs.set(Number(m[2]), { kind: m[1], abstraction: m[4] ?? "-", name: unescape(m[3]), description: description ? unescape(description[1]) : "" });
  }
}
// LMR1c: the table is a list of [classes, ids], and each CWE's class column is its set.
const rows = [...TRAP_CWES.map(id => [id, "trap"]), ...CWE_CLASSES.flatMap(([classes, ids]) => ids.map(id => [id, classes.join(" or ")])), ...DECIDED_UNCLASSIFIED.map(id => [id, "unclassified (decided)"])];
console.log(["cwe", "class", "abstraction", "name", "description"].join("\t"));
for (const [id, c] of rows) {
  const d = defs.get(id);
  console.log([`CWE-${id}`, c, d ? `${d.kind === "Weakness" ? d.abstraction : d.kind}` : "NOT IN THE LIST", d?.name ?? "", d?.description ?? ""].join("\t"));
}
