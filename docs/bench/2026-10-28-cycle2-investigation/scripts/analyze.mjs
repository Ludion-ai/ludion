// Compares jsDelivr's per-file hashes for @ensdomains/buffer 0.1.0, 0.1.1 and 0.1.2,
// and checks jsDelivr's 0.1.0 hashes against the registry's own 0.1.0 tarball (extracted by tar, never run).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

function flat(list, prefix = "", out = new Map()) {
  for (const f of list.files) {
    const p = prefix ? `${prefix}/${f.name}` : f.name;
    if (f.type === "directory") flat(f, p, out);
    else out.set(p, { hash: f.hash, size: f.size });
  }
  return out;
}
const lists = {};
for (const v of ["0.1.0", "0.1.1", "0.1.2"]) {
  lists[v] = flat(JSON.parse(readFileSync(`/out/raw/jsdelivr-${v}-list.json`, "utf8")));
  console.log(`jsDelivr ${v}: ${lists[v].size} files`);
}

execFileSync("tar", ["-xzf", "/out/raw/reg-tgz-0.1.0.tgz", "-C", "/tmp"]);
function walk(dir, base = dir, out = new Map()) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else {
      const b = readFileSync(p);
      out.set(p.slice(base.length + 1), { hash: createHash("sha256").update(b).digest("base64"), size: b.length });
    }
  }
  return out;
}
const reg010 = walk("/tmp/package");
console.log(`registry 0.1.0 tarball: ${reg010.size} files`);
let same = 0;
const differ = [];
for (const [p, x] of reg010) {
  const j = lists["0.1.0"].get(p);
  if (j && j.hash === x.hash) same++;
  else differ.push(p);
}
console.log(`registry 0.1.0 vs jsDelivr 0.1.0: ${same} identical, differing or missing in jsDelivr: ${JSON.stringify(differ)}`);
console.log(`in jsDelivr 0.1.0 but not the tarball: ${JSON.stringify([...lists["0.1.0"].keys()].filter((p) => !reg010.has(p)))}`);

function diff(a, b) {
  const A = lists[a], B = lists[b];
  const added = [...B.keys()].filter((p) => !A.has(p));
  const removed = [...A.keys()].filter((p) => !B.has(p));
  const changed = [...B.keys()].filter((p) => A.has(p) && A.get(p).hash !== B.get(p).hash);
  console.log(`\n${a} -> ${b}`);
  console.log(" added:", JSON.stringify(added.map((p) => `${p} (${B.get(p).size})`)));
  console.log(" removed:", JSON.stringify(removed));
  console.log(" changed:", JSON.stringify(changed.map((p) => `${p} (${A.get(p).size} -> ${B.get(p).size})`)));
}
diff("0.1.0", "0.1.1");
diff("0.1.1", "0.1.2");
