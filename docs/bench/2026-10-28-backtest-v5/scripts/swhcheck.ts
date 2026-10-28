import { Archive, scriptsFromFiles, swhLocate, swhManifest } from "/w/tools/backtest/src/archives-v5.ts";
const archive = new Archive("/cache");
const hold = await swhLocate(archive, "@ensdomains/buffer", "0.1.1", "2023-02-28T09:46:00.601Z");
console.log(JSON.stringify(hold));
if (hold !== "unreadable" && hold.held) {
  const m = await swhManifest(archive, hold.packageRoot);
  console.log(typeof m === "string" ? m : JSON.stringify({ scripts: (m.pkg as any).scripts, bindingGyp: m.bindingGyp, install: scriptsFromFiles(m.pkg, m.bindingGyp) }));
}
console.log(JSON.stringify(archive.counters));
