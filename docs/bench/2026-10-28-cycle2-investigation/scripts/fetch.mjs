// Reads public metadata only; writes JSON to /out.
import { writeFile } from "node:fs/promises";
const urls = {
  "osv-MAL-2025-190866.json": "https://api.osv.dev/v1/vulns/MAL-2025-190866",
  "osv-GHSA-rrxv-q8m4-wch3.json": "https://api.osv.dev/v1/vulns/GHSA-rrxv-q8m4-wch3",
  "packument-buffer.json": "https://registry.npmjs.org/@ensdomains%2fbuffer",
  "packument-ens-contracts.json": "https://registry.npmjs.org/@ensdomains%2fens-contracts",
  "depsdev-buffer.json": "https://api.deps.dev/v3/systems/npm/packages/%40ensdomains%2Fbuffer",
  "depsdev-buffer-0.1.1.json": "https://api.deps.dev/v3/systems/npm/packages/%40ensdomains%2Fbuffer/versions/0.1.1",
  "depsdev-buffer-0.1.0.json": "https://api.deps.dev/v3/systems/npm/packages/%40ensdomains%2Fbuffer/versions/0.1.0",
  "osv-query-buffer.json": null,
};
for (const [file, url] of Object.entries(urls)) {
  let res;
  if (url === null) {
    res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name: "@ensdomains/buffer", ecosystem: "npm" } }),
    });
  } else {
    res = await fetch(url, { redirect: "error" });
  }
  const body = await res.text();
  await writeFile(`/out/${file}`, body);
  console.log(file, res.status, body.length);
}
