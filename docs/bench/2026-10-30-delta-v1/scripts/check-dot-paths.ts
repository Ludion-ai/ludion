// After the result (README, "A . path segment is not removed"): per version, how many tarball paths keep a "." segment,
// and how many of those also appear without it. Every registry-held version of the 11 obtained malicious pairs, and
// js-toml. Each tarball is checked against the registry's sha512 integrity. Prints names, versions, the integrity flag
// and counts; no path and no content. Run in a credential-free container: node check-dot-paths.ts
import { createHash } from "node:crypto";
import { untar } from "/w/tools/backtest/src/delta.ts";
const pairs: [string, string[]][] = [
  ["@asyncapi/studio", ["0.20.0", "0.20.1", "0.20.2"]],
  ["@igh/server-updater-ssh", ["1.2.4", "1.2.16"]],
  ["@igh/server-updater-ssh-l1", ["1.2.8", "1.2.17"]],
  ["freo-design-system", ["1.0.0", "1.0.1", "1.0.4"]],
  ["@dm3-org/dm3-lib-shared", ["1.7.1", "1.7.2"]],
  ["@react-native-aria/switch", ["0.2.4", "0.2.5"]],
  ["@ensdomains/buffer", ["0.1.0"]],
  ["@voiceflow/natural-language-commander", ["0.5.1"]],
  ["eslint-config-kinvey-flex-service", ["0.1.0"]],
  ["js-toml", ["1.0.1", "1.0.2"]],
];
for (const [name, versions] of pairs) {
  const doc = await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)).json();
  for (const v of versions) {
    const url = `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${v}.tgz`;
    const body = Buffer.from(await (await fetch(url)).arrayBuffer());
    const ok = `sha512-${createHash("sha512").update(body).digest("base64")}` === doc.versions?.[v]?.dist?.integrity;
    const paths = [...untar(body).keys()];
    const dotted = paths.filter(p => p.split("/").includes("."));
    const plain = new Set(paths.filter(p => !p.split("/").includes(".")));
    console.log(name, v, "integrity ok", ok, "files", paths.length, "with a . segment", dotted.length, "of which also present without it", dotted.filter(p => plain.has(p.split("/").filter(s => s !== ".").join("/"))).length);
  }
}
