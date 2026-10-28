// Public read-only: the changed files of 0.1.0 -> 0.1.1 from jsDelivr (text only, never executed).
import { writeFile, mkdir } from "node:fs/promises";
await mkdir("/out/files", { recursive: true });
const files = [
  ["0.1.0", "package.json"],
  ["0.1.1", "package.json"],
  ["0.1.0", "cache/solidity-files-cache.json"],
  ["0.1.1", "cache/solidity-files-cache.json"],
  ["0.1.1", "package-lock.json"],
  ["0.1.2", "package.json"],
];
for (const [v, p] of files) {
  const url = `https://cdn.jsdelivr.net/npm/@ensdomains/buffer@${v}/${p}`;
  const res = await fetch(url, { redirect: "error" });
  const body = Buffer.from(await res.arrayBuffer());
  await writeFile(`/out/files/${v}__${p.replaceAll("/", "_")}`, body);
  console.log(v, p, res.status, body.length);
}
