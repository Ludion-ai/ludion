import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { capabilityCounts, delta, entropy, isBinary, isCode, untar, type Files } from "../src/delta.ts";

/** A minimal ustar archive, as in archives-v5.test.ts. */
function tar(entries: { name: string; body?: string | Buffer; type?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.isBuffer(e.body) ? e.body : Buffer.from(e.body ?? "");
    const header = Buffer.alloc(512);
    header.write(e.name, 0, 100, "utf8");
    header.write(body.length.toString(8).padStart(11, "0"), 124, 12, "ascii");
    header.write(e.type ?? "0", 156, 1, "ascii");
    header.write("ustar", 257, 6, "ascii");
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
const pkg = (o: Record<string, unknown> = {}) => JSON.stringify({ name: "p", version: "1.0.0", ...o });
const files = (o: Record<string, string | Buffer>): Files => new Map(Object.entries(o).map(([p, b]) => [p, Buffer.isBuffer(b) ? b : Buffer.from(b)]));
const judged = (prev: Record<string, string | Buffer>, next: Record<string, string | Buffer>) => {
  const d = delta(files(prev), files(next));
  if (d.status === "undecidable") throw new Error(d.why);
  return d;
};
const NL = String.fromCharCode(10);

describe("untar", () => {
  it("keeps each file's bytes without the top folder, and links as their target", () => {
    const f = untar(tar([{ name: "package/", type: "5" }, { name: "package/package.json", body: "{}" }, { name: "package/lib/a.js", body: "x" }, { name: "package/l", type: "2" }]));
    expect([...f.keys()].sort()).toEqual(["l", "lib/a.js", "package.json"]);
    expect(f.get("lib/a.js")!.toString()).toBe("x");
    expect(f.get("l")!.toString()).toMatch(/^link:/);
  });
  it("refuses a truncated archive", () => {
    const raw = gunzipSync(tar([{ name: "package/a.js", body: "y".repeat(2000) }]));
    expect(() => untar(gzipSync(raw.subarray(0, 1000)))).toThrow(/truncated/);
  });
});

describe("capabilityCounts", () => {
  it("counts require, import, dynamic import and re-export of the listed modules, with or without node:", () => {
    const c = capabilityCounts([
      `const cp = require("child_process");`,
      `import net from 'node:net';`,
      `import "dns";`,
      `const h = await import("https");`,
      `export { request } from "http2";`,
      `const x = require("fs"); const y = require("child_process_x");`,
    ].join(NL));
    expect(c["module:child_process"]).toBe(1);
    expect(c["module:net"]).toBe(1);
    expect(c["module:dns"]).toBe(1);
    expect(c["module:http(s)"]).toBe(2);
    expect(c["module:vm"]).toBe(0);
  });
  it("counts network APIs and code from strings", () => {
    const c = capabilityCounts(`fetch(u); new XMLHttpRequest(); new WebSocket(u); eval(s); new Function("a", s); prefetch(x);`);
    expect([c["api:fetch"], c["api:XMLHttpRequest"], c["api:WebSocket"], c["code:eval"], c["code:new Function"]]).toEqual([1, 1, 1, 1, 1]);
  });
  it("counts obfuscation markers at their thresholds", () => {
    expect(capabilityCounts(`"${"ab12".repeat(50)}"`)["obf:long-hex"]).toBe(1);
    expect(capabilityCounts(`"${"ab12".repeat(49)}a"`)["obf:long-hex"]).toBe(0);
    expect(capabilityCounts(`"${"\\x41".repeat(50)}"`)["obf:long-hex"]).toBe(1);
    expect(capabilityCounts(`"${"Zm9vYmFy".repeat(25)}"`)["obf:long-base64"]).toBe(1);
    // A long hex run is not counted as base64 too.
    expect(capabilityCounts(`"${"ab12".repeat(60)}"`)["obf:long-base64"]).toBe(0);
    expect(capabilityCounts("x".repeat(5000))["obf:very-long-line"]).toBe(1);
    expect(capabilityCounts("x".repeat(4999))["obf:very-long-line"]).toBe(0);
    expect(capabilityCounts("var _0x1a2b = 1; _0x1a2b++; _0x12; _0x1a2bg; a_0x1a2b;")["obf:_0x-names"]).toBe(2);
    expect(capabilityCounts(`_0x${"f".repeat(1 << 22)}`)["obf:_0x-names"]).toBe(1);
  });
  it("counts runs of several megabytes without overflowing the stack (docs/mistakes/2026-10-30-delta-regex-stack.md)", () => {
    const huge = "Zm9vYmFy".repeat(1 << 20);
    const c = capabilityCounts(`a = "${huge}"; b = "${"ab".repeat(1 << 21)}"; c = "${"\\x41".repeat(1 << 20)}";`);
    expect([c["obf:long-base64"], c["obf:long-hex"]]).toEqual([1, 2]);
  });
  it("counts maximal runs, as a regular expression would", () => {
    expect(capabilityCounts(`"${"a1".repeat(150)}" + "${"b2".repeat(100)}"`)["obf:long-hex"]).toBe(2);
    expect(capabilityCounts(`"${"\\x41".repeat(49)}\\u0041"`)["obf:long-hex"]).toBe(0);
    expect(capabilityCounts(`"${"\\u0041".repeat(50)}"`)["obf:long-hex"]).toBe(1);
    expect(capabilityCounts(`"${"Zm9v".repeat(50)}.${"Zm9v".repeat(49)}"`)["obf:long-base64"]).toBe(1);
  });
  it("finds a high-entropy line only when it is long enough", () => {
    let s = "";
    for (let i = 0; i < 400; i++) s += String.fromCharCode(33 + ((i * 37) % 94));
    expect(entropy(s)).toBeGreaterThan(5.5);
    expect(capabilityCounts(s)["obf:high-entropy-line"]).toBe(1);
    expect(capabilityCounts(s.slice(0, 199))["obf:high-entropy-line"]).toBe(0);
    expect(capabilityCounts("a".repeat(300))["obf:high-entropy-line"]).toBe(0);
  });
});

describe("isCode and isBinary", () => {
  it("reads code files by extension, bin entries and node shebangs, not declarations", () => {
    expect(isCode("a.mjs", Buffer.from(""), new Set())).toBe(true);
    expect(isCode("a.d.ts", Buffer.from(""), new Set())).toBe(false);
    expect(isCode("bin/cli", Buffer.from(`#!/usr/bin/env node${NL}x`), new Set())).toBe(true);
    expect(isCode("bin/cli", Buffer.from("#!/bin/sh"), new Set())).toBe(false);
    expect(isCode("tool.sh", Buffer.from(""), new Set(["tool.sh"]))).toBe(true);
    expect(isCode("README.md", Buffer.from(""), new Set())).toBe(false);
  });
  it("knows executables by extension and magic bytes", () => {
    expect(isBinary("a.node", Buffer.from(""))).toBe(true);
    expect(isBinary("x", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1]))).toBe(true);
    const pe = Buffer.alloc(0x50); pe.write("MZ", 0); pe.writeUInt32LE(0x40, 0x3c); pe.write("PE\0\0", 0x40, "latin1");
    expect(isBinary("x", pe)).toBe(true);
    const notPe = Buffer.alloc(0x50); notPe.write("MZ", 0);
    expect(isBinary("x", notPe)).toBe(false);
    expect(isBinary("logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("delta", () => {
  it("is clean when nothing but the version and a fix inside existing code changes, and measures the size", () => {
    const d = judged(
      { "package.json": pkg(), "index.js": `const cp = require("child_process");${NL}if (a) run();${NL}` },
      { "package.json": pkg({ version: "1.0.1" }), "index.js": `const cp = require("child_process");${NL}if (a && b) run();${NL}` },
    );
    expect(d.status).toBe("clean");
    expect(d.capabilities).toEqual([]);
    expect(d.size).toEqual({ filesAdded: 0, filesRemoved: 0, filesChanged: 2, codeFilesChanged: 1, linesAdded: 2, linesRemoved: 2 });
  });
  it("flags a module a changed file did not use before", () => {
    const d = judged({ "package.json": pkg(), "index.js": "module.exports = 1;" }, { "package.json": pkg(), "index.js": `require("child_process").exec(x); module.exports = 1;` });
    expect(d.status).toBe("flagged");
    expect(d.capabilities).toEqual(["module:child_process"]);
    expect(d.where["module:child_process"]).toEqual(["index.js"]);
  });
  it("flags one more use in a file that already had one (counts, not presence)", () => {
    const d = judged({ "package.json": pkg(), "a.js": "fetch(a);" }, { "package.json": pkg(), "a.js": "fetch(a); fetch(b);" });
    expect(d.capabilities).toEqual(["api:fetch"]);
  });
  it("flags a capability in a new file, but not in a file moved unchanged", () => {
    const body = `require("net");`;
    expect(judged({ "package.json": pkg() }, { "package.json": pkg(), "lib/x.js": body }).capabilities).toEqual(["module:net"]);
    const moved = judged({ "package.json": pkg(), "a/x.js": body }, { "package.json": pkg(), "b/x.js": body });
    expect(moved.status).toBe("clean");
    expect(moved.size.codeFilesChanged).toBe(0);
    expect(moved.size.filesAdded).toBe(1);
    expect(moved.size.filesRemoved).toBe(1);
  });
  it("does not read capabilities in files that are not code", () => {
    expect(judged({ "package.json": pkg() }, { "package.json": pkg(), "README.md": `eval(x); require("child_process")` }).status).toBe("clean");
  });
  it("flags an added or changed install script, and binding.gyp without one", () => {
    expect(judged({ "package.json": pkg() }, { "package.json": pkg({ scripts: { postinstall: "node a" } }) }).where["install-script"]).toEqual(["postinstall"]);
    expect(judged({ "package.json": pkg({ scripts: { preinstall: "node a" } }) }, { "package.json": pkg({ scripts: { preinstall: "node b" } }) }).capabilities).toEqual(["install-script"]);
    expect(judged({ "package.json": pkg({ scripts: { preinstall: "node a", test: "x" } }) }, { "package.json": pkg({ scripts: { preinstall: "node a", test: "y" } }) }).status).toBe("clean");
    expect(judged({ "package.json": pkg() }, { "package.json": pkg(), "binding.gyp": "{}" }).where["install-script"]).toEqual(["install (binding.gyp)"]);
    expect(judged({ "package.json": pkg() }, { "package.json": pkg({ gypfile: false }), "binding.gyp": "{}" }).status).toBe("clean");
  });
  it("flags a new runtime dependency, not a changed range, a moved one or a dev dependency", () => {
    const prev = { "package.json": pkg({ dependencies: { a: "^1.0.0" }, peerDependencies: { b: "*" } }) };
    expect(judged(prev, { "package.json": pkg({ dependencies: { a: "^2.0.0", b: "1" }, devDependencies: { c: "1" } }) }).status).toBe("clean");
    expect(judged(prev, { "package.json": pkg({ dependencies: { a: "^1.0.0" }, optionalDependencies: { d: "1" } }) }).where["new-dependency"]).toEqual(["d"]);
  });
  it("flags an added or changed binary, not one left alone", () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2]);
    expect(judged({ "package.json": pkg() }, { "package.json": pkg(), "bin/x": elf }).capabilities).toEqual(["binary"]);
    expect(judged({ "package.json": pkg(), "a.node": "1" }, { "package.json": pkg(), "a.node": "2" }).capabilities).toEqual(["binary"]);
    expect(judged({ "package.json": pkg(), "a.node": "1" }, { "package.json": pkg({ version: "2" }), "a.node": "1" }).status).toBe("clean");
  });
  it("flags obfuscation markers that grow in a changed file", () => {
    const d = judged({ "package.json": pkg(), "a.js": "x();" }, { "package.json": pkg(), "a.js": `x(); var _0xabcd = "${"Zm9vYmFy".repeat(30)}";` });
    expect(d.capabilities).toEqual(["obf:long-base64", "obf:_0x-names"]);
  });
  it("shows script files, reference counts and the package-wide reading without changing the verdict", () => {
    const d = judged(
      { "package.json": pkg(), "a.js": `require("net");`, "b.js": "" },
      { "package.json": pkg(), "a.js": "", "b.js": `require("net"); require("net"); process.env.X; atob(y);`, "run.sh": "echo" },
    );
    expect(d.capabilities).toEqual(["module:net"]);
    expect(d.shown).toEqual({ scriptFiles: ["run.sh"], reference: ["ref:process.env", "ref:atob"], packageWide: ["module:net"] });
    const balanced = judged({ "package.json": pkg(), "a.js": `require("net");`, "b.js": "" }, { "package.json": pkg(), "a.js": "", "b.js": `require("net"); x();` });
    expect(balanced.capabilities).toEqual(["module:net"]);
    expect(balanced.shown.packageWide).toEqual([]);
  });
  it("is undecidable without a readable root package.json", () => {
    expect(delta(files({ "a.js": "" }), files({ "package.json": pkg() }))).toEqual({ status: "undecidable", why: "previous: no root package.json" });
    expect(delta(files({ "package.json": pkg() }), files({ "package.json": "[1]" }))).toEqual({ status: "undecidable", why: "new: package.json is not an object" });
    expect(delta(files({ "package.json": pkg() }), files({ "package.json": "{" }))).toEqual({ status: "undecidable", why: "new: package.json is not JSON" });
  });
});
