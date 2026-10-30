// Checks of lold2.ts on made-up inputs. Run before the execution (run.sh); any failure stops it.
import { gzipSync } from "node:zlib";
import { bucket, contentDelta, explain, lineSet, quantile, readSourceTar, timeStats } from "./lold2.ts";

let failed = 0;
const check = (what: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { failed++; console.log(`FAIL ${what}: got ${g}, want ${w}`); }
};
const files = (o: Record<string, string>) => new Map(Object.entries(o).map(([p, t]) => [p, Buffer.from(t)]));
const pkg = (extra: Record<string, unknown> = {}) => JSON.stringify({ name: "x", version: "1.0.0", ...extra });
const body = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `const ${tag}${i} = ${i};`).join("\n");

// lineSet: trimmed, distinct, empty lines dropped.
check("lineSet", [...lineSet(Buffer.from("  a \n\nb\na\n\t\n"))], ["a", "b"]);

// A chunk renamed by content hash, its capability unchanged: v1 flags it, content matching does not.
{
  const shared = `${body(20, "s")}\nconst cp = require("child_process");\nfetch("x");`;
  const prev = files({ "package.json": pkg(), "dist/chunks/dep-AAAA1111.js": shared });
  const next = files({ "package.json": pkg(), "dist/chunks/dep-BBBB2222.js": `${shared}\nconst extra = 1;` });
  const d = contentDelta(prev, next);
  check("renamed chunk: v1", d.status !== "undecidable" && d.v1.capabilities, ["module:child_process", "api:fetch"]);
  check("renamed chunk: content", d.status, "clean");
  check("renamed chunk: predecessor", d.status !== "undecidable" && d.matched.map(m => [m.predecessor, m.how]), [["dist/chunks/dep-AAAA1111.js", "content"]]);
}
// A renamed chunk that also gains a capability is still flagged.
{
  const shared = body(20, "s");
  const prev = files({ "package.json": pkg(), "dist/a-1.js": shared });
  const next = files({ "package.json": pkg(), "dist/a-2.js": `${shared}\nrequire("net");` });
  const d = contentDelta(prev, next);
  check("renamed and new: content", d.status !== "undecidable" && d.capabilities, ["module:net"]);
}
// Below the threshold, the same path is the predecessor; with no same path, none.
{
  const prev = files({ "package.json": pkg(), "lib/a.js": `${body(10, "p")}\nfetch("x");`, "lib/b.js": body(10, "q") });
  const next = files({ "package.json": pkg(), "lib/a.js": `${body(10, "n")}\nfetch("y");`, "lib/c.js": `${body(10, "m")}\neval("1");` });
  const d = contentDelta(prev, next);
  check("same path fallback", d.status !== "undecidable" && d.matched.map(m => [m.path, m.predecessor, m.how]), [["lib/a.js", "lib/a.js", "same path"], ["lib/c.js", null, "none"]]);
  check("same path fallback: capabilities", d.status !== "undecidable" && d.capabilities, ["code:eval"]);
}
// Ties go to the same path, then to the first path.
{
  const t = body(10, "t");
  const prev = files({ "package.json": pkg(), "b.js": t, "a.js": t, "c.js": t });
  const next1 = files({ "package.json": pkg(), "c.js": `${t}\n// x` });
  const d1 = contentDelta(prev, next1);
  check("tie: same path", d1.status !== "undecidable" && d1.matched[0]!.predecessor, "c.js");
  const next2 = files({ "package.json": pkg(), "d.js": `${t}\n// x` });
  const d2 = contentDelta(prev, next2);
  check("tie: first path", d2.status !== "undecidable" && d2.matched[0]!.predecessor, "a.js");
}
// Rules 4-6 come from v1 unchanged; an undecidable pair stays undecidable.
{
  const prev = files({ "package.json": pkg({ dependencies: { a: "1" } }) });
  const next = files({ "package.json": pkg({ dependencies: { a: "1", b: "1" }, scripts: { postinstall: "node x" } }) });
  const d = contentDelta(prev, next);
  check("rules 4-5", d.status !== "undecidable" && d.where, { "install-script": ["postinstall"], "new-dependency": ["b"] });
  check("undecidable", contentDelta(files({ "a.js": "" }), files({ "package.json": pkg() })).status, "undecidable");
}

// explain: by name, and per name for dependencies and install scripts.
check("explain", explain({ "api:fetch": ["dist/a.js"], "new-dependency": ["a", "b"], "install-script": ["postinstall"], "obf:very-long-line": ["dist/a.js"] }, { "api:fetch": ["src/a.ts"], "new-dependency": ["a"], "install-script": ["postinstall"] }),
  { explained: ["api:fetch", "install-script"], unexplained: ["obf:very-long-line", "new-dependency"] });

// readSourceTar: top folder stripped, package.json texts kept everywhere, bytes kept only under the directory.
function header(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(`${size.toString(8).padStart(11, "0")}\0`, 124); h.write("00000000000\0", 136);
  h.write(type, 156); h.write("ustar\0", 257); h.write("00", 263);
  h.write("        ", 148);
  let sum = 0; for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}
function tar(entries: [string, string, string?][]): Buffer {
  const parts: Buffer[] = [];
  for (const [name, text, type = "0"] of entries) {
    const b = Buffer.from(text);
    parts.push(header(name, b.length, type), b, Buffer.alloc((512 - (b.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
{
  const t = tar([["repo-abc/", "", "5"], ["repo-abc/package.json", pkg({ name: "root" })], ["repo-abc/packages/x/package.json", pkg()], ["repo-abc/packages/x/index.js", "fetch(1)"], ["repo-abc/other.js", "1"]]);
  check("gzip round trip", gzipSync(t).length > 0, true);
  const all = readSourceTar(t, "");
  check("tar: all paths", [...all.paths].sort(), ["other.js", "package.json", "packages/x/index.js", "packages/x/package.json"]);
  check("tar: package.json texts", [...all.packageJsons.keys()].sort(), ["package.json", "packages/x/package.json"]);
  const sub = readSourceTar(t, "packages/x");
  check("tar: kept under directory", [...sub.kept.keys()].sort(), ["index.js", "package.json"]);
  check("tar: none kept", readSourceTar(t, null).kept.size, 0);
}

// Time statistics.
check("quantile odd", quantile([1, 2, 3], 0.5), 2);
check("quantile even", quantile([1, 2, 3, 4], 0.5), 2.5);
check("quantile empty", quantile([], 0.5), null);
check("buckets", [-200, -168, -100, -24, -2, -1, -0.5, 0, 0.5, 1, 2, 24, 100, 168, 169].map(bucket),
  ["<= -168h", "<= -168h", "(-168h, -24h]", "(-168h, -24h]", "(-24h, -1h]", "(-24h, -1h]", "(-1h, 0h]", "(-1h, 0h]", "(0h, 1h]", "(0h, 1h]", "(1h, 24h]", "(1h, 24h]", "(24h, 168h]", "(24h, 168h]", "> 168h"]);
check("timeStats", timeStats([3, -1, 2]), { n: 3, min: -1, q1: 0.5, median: 2, q3: 2.5, max: 3, buckets: { "<= -168h": 0, "(-168h, -24h]": 0, "(-24h, -1h]": 1, "(-1h, 0h]": 0, "(0h, 1h]": 0, "(1h, 24h]": 2, "(24h, 168h]": 0, "> 168h": 0 } });

if (failed) { console.log(`selftest: ${failed} failed`); process.exit(1); }
console.log("selftest: all checks passed");
