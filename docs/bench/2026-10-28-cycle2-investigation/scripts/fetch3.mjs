// Public read-only: mirror copies of the removed tarballs, and full ecosyste.ms metadata for 0.1.2.
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const urls = {
  "npmmirror-0.1.1.json": "https://registry.npmmirror.com/@ensdomains/buffer/0.1.1",
  "npmmirror-0.1.1.tgz": "https://registry.npmmirror.com/@ensdomains/buffer/-/buffer-0.1.1.tgz",
  "npmmirror-pkg.json": "https://registry.npmmirror.com/@ensdomains/buffer",
  "yarn-0.1.1.tgz": "https://registry.yarnpkg.com/@ensdomains/buffer/-/buffer-0.1.1.tgz",
  "ecosystems-0.1.2.json": "https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/%40ensdomains%2Fbuffer/versions/0.1.2",
  "ecosystems-0.1.0.json": "https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/%40ensdomains%2Fbuffer/versions/0.1.0",
  "jsdelivr-0.1.0-list.json": "https://data.jsdelivr.com/v1/packages/npm/@ensdomains/buffer@0.1.0",
  "jsdelivr-0.1.2-list.json": "https://data.jsdelivr.com/v1/packages/npm/@ensdomains/buffer@0.1.2",
};
for (const [file, url] of Object.entries(urls)) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "ludion-research (read-only)" } });
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(`/out/raw/${file}`, buf);
    const sri = "sha512-" + createHash("sha512").update(buf).digest("base64");
    console.log(file, res.status, buf.length, file.endsWith(".tgz") ? sri : "", res.url === url ? "" : `-> ${res.url}`);
  } catch (e) {
    console.log(file, "ERR", String(e));
  }
}
