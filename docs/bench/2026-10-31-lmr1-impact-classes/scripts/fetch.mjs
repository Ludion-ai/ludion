// node fetch.mjs <dir>: download the two OSV bulk exports into <dir> and write <dir>/fetch.json. Runs in Docker only.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const exports = { npm: "https://osv-vulnerabilities.storage.googleapis.com/npm/all.zip", Packagist: "https://osv-vulnerabilities.storage.googleapis.com/Packagist/all.zip" };
const out = {};
for (const [ecosystem, url] of Object.entries(exports)) {
  const fetched_at = new Date().toISOString();
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(dir, `${ecosystem}.zip`), bytes);
  out[ecosystem] = { url, fetched_at, last_modified: response.headers.get("last-modified"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  console.log(JSON.stringify({ ecosystem, ...out[ecosystem] }));
}
writeFileSync(join(dir, "fetch.json"), JSON.stringify(out, null, 2) + "\n");
