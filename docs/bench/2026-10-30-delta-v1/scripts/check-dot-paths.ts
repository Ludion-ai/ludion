// Prints, per version, how many tarball paths keep a "." segment, and whether such a path's
// normalised form equals another path. Prints no path and no content.
import { createHash } from "node:crypto";
import { untar } from "/w/tools/backtest/src/delta.ts";
const pairs: [string, string[]][] = [["@asyncapi/studio", ["0.20.0", "0.20.1", "0.20.2"]], ["js-toml", ["1.0.1", "1.0.2"]]];
for (const [name, versions] of pairs) {
  const doc = await (await fetch(`https://registry.npmjs.org/${name.replace("/", "%2f")}`)).json();
  for (const v of versions) {
    const url = `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${v}.tgz`;
    const body = Buffer.from(await (await fetch(url)).arrayBuffer());
    const ok = `sha512-${createHash("sha512").update(body).digest("base64")}` === doc.versions[v].dist.integrity;
    const paths = [...untar(body).keys()];
    const dotted = paths.filter(p => p.split("/").includes("."));
    const norm = new Set(paths.filter(p => !p.split("/").includes(".")));
    console.log(name, v, "integrity ok", ok, "files", paths.length, "with a . segment", dotted.length, "of which also present normalised", dotted.filter(p => norm.has(p.split("/").filter(s => s !== ".").join("/"))).length);
  }
}
