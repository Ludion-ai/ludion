// LOLD2: records the packument copies the tests read, keeping only what the resolver reads: each version's publish time
// and its requirements and deprecation. Docker only. Usage: node record.mjs <dest dir> <name> ...
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dest, ...names] = process.argv.slice(2);
mkdirSync(dest, { recursive: true });
const PICK = ["dependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "deprecated"];
for (const name of names) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const doc = await res.json();
  const versions = Object.fromEntries(Object.entries(doc.versions).map(([version, manifest]) => [version, Object.fromEntries(PICK.filter(key => manifest[key] !== undefined).map(key => [key, manifest[key]]))]));
  writeFileSync(join(dest, `${name.replaceAll("/", "__")}.json`), `${JSON.stringify({ name, recorded_at: new Date().toISOString(), time: doc.time, versions })}\n`);
  console.log(name, Object.keys(versions).length);
}
