// After the result (README, "Module names in backticks"): per version, how many require(`m`) / import(`m`) calls name a
// rule-1 module in backticks, over all code files. Every registry-held version of the 11 obtained malicious pairs.
// Each tarball is checked against the registry's sha512 integrity. Prints names, versions, the flag and counts only.
// Run in a credential-free container: node check-backtick-modules.ts
import { createHash } from "node:crypto";
import { isCode, untar } from "/w/tools/backtest/src/delta.ts";
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
];
const BACKTICK = /\b(?:require|import)\s*\(\s*\x60(?:node:)?(?:child_process|net|https?|http2|dns|tls|dgram|worker_threads|vm)\x60\s*\)/g;
for (const [name, versions] of pairs) {
  const doc = await (await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`)).json();
  for (const v of versions) {
    const body = Buffer.from(await (await fetch(`https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${v}.tgz`)).arrayBuffer());
    const ok = `sha512-${createHash("sha512").update(body).digest("base64")}` === doc.versions?.[v]?.dist?.integrity;
    const files = untar(body);
    let bins = new Set<string>();
    try { const b = JSON.parse(files.get("package.json")!.toString("utf8")).bin; bins = new Set((typeof b === "string" ? [b] : Object.values(b ?? {})).map(p => String(p).replace(/^[.]?[/]/, ""))); } catch {}
    let n = 0;
    for (const [p, bytes] of files) if (isCode(p, bytes, bins)) n += bytes.toString("utf8").match(BACKTICK)?.length ?? 0;
    console.log(name, v, "integrity ok", ok, "backtick module loads", n);
  }
}
