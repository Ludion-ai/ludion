// Prints only numbers and module names about one file; never its text.
import { createHash } from "node:crypto";
import { registryTarball } from "/w/packages/cli/src/security/judge.ts";
import { Archive, registryVersions } from "/w/tools/backtest/src/archives-v5.ts";
import { capabilityCounts, entropy, untar } from "/w/tools/backtest/src/delta.ts";
const archive = new Archive("/tmp/c");
const name = "@react-native-aria/switch";
const d = await registryVersions(archive, "/tmp/c", name);
for (const version of ["0.2.4", "0.2.5"]) {
  const res = await archive.bytes("registry-tarball", registryTarball(name, version));
  const ok = `sha512-${createHash("sha512").update(res!.body!).digest("base64")}` === d![version]!.integrity;
  const files = untar(res!.body!);
  console.log(version, "integrity ok", ok, "files", [...files.keys()].sort().join(","));
  const text = files.get("lib/commonjs/index.js")!.toString("utf8");
  const lines = text.split("\n");
  const lens = lines.map(l => l.length);
  const ws = Math.max(0, ...(text.match(/[ \t]{20,}/g) ?? []).map(s => s.length));
  console.log("  bytes", text.length, "lines", lines.length, "max line", Math.max(...lens), "lines>=1000", lens.filter(n => n >= 1000).length, "max entropy (>=200)", Math.max(0, ...lines.filter(l => l.length >= 200).map(entropy)).toFixed(2), "longest whitespace run", ws);
  console.log("  require targets", JSON.stringify([...text.matchAll(/require\s*\(\s*['"]([^'"]{1,80})['"]\s*\)/g)].map(m => m[1])));
  console.log("  counts>0", JSON.stringify(Object.fromEntries(Object.entries(capabilityCounts(text)).filter(([, v]) => v > 0))));
  console.log("  non-ascii chars", [...text].filter(c => c.charCodeAt(0) > 126).length, "global[", (text.match(/global\s*\[/g) ?? []).length, "String.fromCharCode", (text.match(/fromCharCode/g) ?? []).length);
}
