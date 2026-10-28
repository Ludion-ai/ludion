// Diffs the two package.json files and lists hosts in 0.1.1's bundled package-lock.json (data only).
import { readFileSync } from "node:fs";
const a = JSON.parse(readFileSync("/out/files/0.1.0__package.json", "utf8"));
const b = JSON.parse(readFileSync("/out/files/0.1.1__package.json", "utf8"));
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
  if (x !== y) console.log(`${k}: ${x} -> ${y}`);
}
const lock = JSON.parse(readFileSync("/out/files/0.1.1__package-lock.json", "utf8"));
const hosts = new Map();
(function walk(deps) {
  for (const d of Object.values(deps ?? {})) {
    if (d.resolved) { const h = d.resolved.startsWith("http") ? new URL(d.resolved).host : d.resolved.split(":")[0]; hosts.set(h, (hosts.get(h) ?? 0) + 1); }
    walk(d.dependencies);
  }
})(lock.dependencies);
console.log("lock name/version", lock.name, lock.version, "lockfileVersion", lock.lockfileVersion, "resolved hosts", JSON.stringify([...hosts]));
