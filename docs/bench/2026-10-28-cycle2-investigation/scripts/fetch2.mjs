// Public read-only lookups for @ensdomains/buffer 0.1.1 and its history. Writes raw bodies to /out/raw.
import { writeFile, mkdir } from "node:fs/promises";
await mkdir("/out/raw", { recursive: true });
const urls = {
  "ghsa-f9pq.json": "https://api.github.com/advisories/GHSA-f9pq-63hg-w434",
  "reg-tgz-0.1.1.tgz": "https://registry.npmjs.org/@ensdomains/buffer/-/buffer-0.1.1.tgz",
  "reg-tgz-0.1.0.tgz": "https://registry.npmjs.org/@ensdomains/buffer/-/buffer-0.1.0.tgz",
  "reg-ver-0.1.1.json": "https://registry.npmjs.org/@ensdomains%2fbuffer/0.1.1",
  "jsdelivr-0.1.1-list.json": "https://data.jsdelivr.com/v1/packages/npm/@ensdomains/buffer@0.1.1",
  "jsdelivr-0.1.1-pkg.json": "https://cdn.jsdelivr.net/npm/@ensdomains/buffer@0.1.1/package.json",
  "jsdelivr-versions.json": "https://data.jsdelivr.com/v1/packages/npm/@ensdomains/buffer",
  "unpkg-0.1.1-pkg.json": "https://unpkg.com/@ensdomains/buffer@0.1.1/package.json",
  "ecosystems-versions.json": "https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/%40ensdomains%2Fbuffer/versions?per_page=100",
  "ecosystems-0.1.1.json": "https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/%40ensdomains%2Fbuffer/versions/0.1.1",
  "wayback-cdx.json": "https://web.archive.org/cdx/search/cdx?url=registry.npmjs.org/@ensdomains/buffer&output=json&limit=50",
  "wayback-cdx2.json": "https://web.archive.org/cdx/search/cdx?url=registry.npmjs.org/@ensdomains%2fbuffer&output=json&limit=50",
  "wayback-cdx-npmjs.json": "https://web.archive.org/cdx/search/cdx?url=www.npmjs.com/package/@ensdomains/buffer*&output=json&limit=50",
  "gh-repo-tags.json": "https://api.github.com/repos/ensdomains/buffer/tags",
  "gh-repo-commits.json": "https://api.github.com/repos/ensdomains/buffer/commits?per_page=30",
};
for (const [file, url] of Object.entries(urls)) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "ludion-research (read-only)" } });
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(`/out/raw/${file}`, buf);
    console.log(file, res.status, buf.length, res.url === url ? "" : `-> ${res.url}`);
  } catch (e) {
    console.log(file, "ERR", String(e));
  }
}
