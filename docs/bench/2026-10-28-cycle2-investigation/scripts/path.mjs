// Which ens-contracts versions declare @ensdomains/buffer, with what range; sizes vs unpackedSize; file diffs of package.json.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const ens = JSON.parse(readFileSync("/out/packument-ens-contracts.json", "utf8"));
const vs = Object.keys(ens.versions).filter((v) => /^0\.0\.(1[5-9]|2[0-9])$/.test(v));
for (const v of vs) {
  const x = ens.versions[v];
  const pick = (g) => (x[g] && x[g]["@ensdomains/buffer"]) || "-";
  console.log(v, ens.time[v], "deps:", pick("dependencies"), "dev:", pick("devDependencies"), "peer:", pick("peerDependencies"), "user:", x._npmUser && x._npmUser.name);
}
const ghsa = JSON.parse(readFileSync("/out/osv-GHSA-rrxv-q8m4-wch3.json", "utf8"));
console.log("GHSA", ghsa.id, "published", ghsa.published, "modified", ghsa.modified, JSON.stringify(ghsa.affected.map((a) => [a.package.name, a.ranges])));

const buf = JSON.parse(readFileSync("/out/packument-buffer.json", "utf8"));
const d = buf.versions["0.1.0"].dist;
console.log("0.1.0 dist fileCount", d.fileCount, "unpackedSize", d.unpackedSize);
const entries = execFileSync("tar", ["-tvzf", "/out/raw/reg-tgz-0.1.0.tgz"]).toString().trim().split("\n");
console.log("0.1.0 tar entries", entries.length, "dirs", entries.filter((l) => l.startsWith("d")).length);

function sum(v) {
  let n = 0, files = 0;
  (function walk(l) { for (const f of l.files) { if (f.type === "directory") walk(f); else { n += f.size; files++; } } })(JSON.parse(readFileSync(`/out/raw/jsdelivr-${v}-list.json`, "utf8")));
  return { bytes: n, files };
}
for (const v of ["0.1.0", "0.1.1", "0.1.2"]) console.log("jsDelivr", v, JSON.stringify(sum(v)));
