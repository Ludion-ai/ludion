import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { codeDifferences, inert, names, scriptsFromFiles, tarFiles, type FileList } from "../src/archives-v5.ts";

/** A minimal ustar archive: each entry is a header block, then its body padded to 512 bytes. */
function tar(entries: { name: string; body?: string; type?: string; prefix?: string }[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body ?? "");
    const header = Buffer.alloc(512);
    header.write(e.name, 0, 100, "utf8");
    header.write(body.length.toString(8).padStart(11, "0"), 124, 12, "ascii");
    header.write(e.type ?? "0", 156, 1, "ascii");
    header.write("ustar", 257, 6, "ascii");
    if (e.prefix) header.write(e.prefix, 345, 155, "utf8");
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const files = (o: Record<string, string>): FileList => new Map(Object.entries(o).map(([p, body]) => [p, { sha256: sha(body), size: body.length }]));

describe("tarFiles", () => {
  it("lists regular files without the top folder, with their sha256, and returns package.json", () => {
    const t = tarFiles(tar([{ name: "package/", type: "5" }, { name: "package/package.json", body: "{}" }, { name: "package/lib/a.js", body: "x" }]));
    expect([...t.files.keys()].sort()).toEqual(["lib/a.js", "package.json"]);
    expect(t.files.get("lib/a.js")).toEqual({ sha256: sha("x"), size: 1 });
    expect(t.packageJson?.toString()).toBe("{}");
  });
  it("takes the path from a pax header, a GNU long name or the ustar prefix", () => {
    const long = `package/${"d".repeat(120)}/b.js`;
    const t = tarFiles(tar([
      { name: "PaxHeader", type: "x", body: `30 path=package/pax/long.js${String.fromCharCode(10)}` },
      { name: "package/short.js", body: "1" },
      { name: "././@LongLink", type: "L", body: long },
      { name: "truncated", body: "2" },
      { name: "c.js", prefix: "package/deep", body: "3" },
    ]));
    expect([...t.files.keys()].sort()).toEqual([`${"d".repeat(120)}/b.js`, "deep/c.js", "pax/long.js"]);
  });
  it("counts a link by its target, so a changed link is a change", () => {
    const a = tarFiles(tar([{ name: "package/x", type: "2" }])).files.get("x");
    expect(a).toBeDefined();
    expect(a!.size).toBe(0);
  });
  it("refuses a truncated archive", () => {
    const whole = tar([{ name: "package/a.js", body: "y".repeat(2000) }]);
    const raw = gunzipSync(whole);
    expect(() => tarFiles(gzipSync(raw.subarray(0, 1000)))).toThrow(/truncated/);
  });
});

describe("scriptsFromFiles", () => {
  it("returns the lifecycle names the package declares", () => {
    expect(scriptsFromFiles({ scripts: { test: "x", postinstall: "y", preinstall: "z" } }, false)).toEqual(["preinstall", "postinstall"]);
  });
  it("adds install for binding.gyp, as npm does", () => {
    expect(scriptsFromFiles({ scripts: {} }, true)).toEqual(["install"]);
    expect(scriptsFromFiles({}, true)).toEqual(["install"]);
  });
  it("adds nothing for binding.gyp when install or preinstall is declared, or gypfile is false", () => {
    expect(scriptsFromFiles({ scripts: { preinstall: "a" } }, true)).toEqual(["preinstall"]);
    expect(scriptsFromFiles({ gypfile: false }, true)).toEqual([]);
  });
});

describe("inert", () => {
  it("treats data and documentation as inert, and the root manifest and code as not", () => {
    for (const p of ["package-lock.json", "cache/solidity-files-cache.json", "README.md", "docs/x.markdown", "a.txt", "dist/a.js.map", "LICENSE", "license.md", "yarn.lock", "sub/package.json"]) expect(inert(p)).toBe(true);
    for (const p of ["package.json", "npm-shrinkwrap.json", "index.js", "types.d.ts", "Buffer.sol", "binding.gyp", "bin/cli", "a.html", "a.svg", ".travis.yml"]) expect(inert(p)).toBe(false);
  });
});

describe("codeDifferences", () => {
  const prevPkg = { name: "p", version: "0.1.0", main: "index.js", scripts: { test: "t" }, dependencies: { dep: "^2.0.0" }, devDependencies: { chai: "^4" } };
  const prev = files({ "package.json": "a", "index.js": "code", "contracts/B.sol": "sol", "build/B.json": "bytecode", "cache/c.json": "1759" });
  it("finds none when only inert files, removals and non-run package.json fields change (the @ensdomains/buffer 0.1.1 case)", () => {
    const v = files({ "package.json": "b", "index.js": "code", "contracts/B.sol": "sol", "cache/c.json": "1751", "package-lock.json": "lock" });
    const vPkg = { ...prevPkg, version: "0.1.1", dependencies: {}, devDependencies: { chai: "^4", dep: "^2.0.0" }, scripts: { test: "t", pub: "yarn publish" } };
    expect(codeDifferences(v, vPkg, prev, prevPkg)).toEqual([]);
  });
  it("reports an added or changed code file", () => {
    const v = files({ "package.json": "b", "index.js": "evil", "contracts/B.sol": "sol", "setup_bun.js": "worm" });
    expect(codeDifferences(v, prevPkg, prev, prevPkg)).toEqual(["changed: index.js", "added: setup_bun.js"]);
  });
  it("reports an install script, an entry point or a new runtime requirement", () => {
    const v = files({ "package.json": "b", "index.js": "code" });
    expect(codeDifferences(v, { ...prevPkg, scripts: { preinstall: "node setup_bun.js" } }, prev, prevPkg)).toEqual(["package.json scripts.preinstall"]);
    expect(codeDifferences(v, { ...prevPkg, main: "other.js" }, prev, prevPkg)).toEqual(["package.json main"]);
    expect(codeDifferences(v, { ...prevPkg, dependencies: { dep: "^2.0.0", extra: "1.0.0" } }, prev, prevPkg)).toEqual(["package.json dependencies.extra"]);
    expect(codeDifferences(v, { ...prevPkg, dependencies: { dep: "^3.0.0" } }, prev, prevPkg)).toEqual(["package.json dependencies.dep"]);
    expect(codeDifferences(v, { ...prevPkg, dependencies: {}, optionalDependencies: { dep: "^2.0.0" } }, prev, prevPkg)).toEqual(["package.json optionalDependencies.dep"]);
  });
  it("compares JSON values regardless of key order", () => {
    const v = files({ "package.json": "b" });
    expect(codeDifferences(v, { ...prevPkg, exports: { b: "./b.js", a: "./a.js" } }, prev, { ...prevPkg, exports: { a: "./a.js", b: "./b.js" } })).toEqual([]);
  });
  it("fails closed when a package.json is missing or unreadable", () => {
    expect(codeDifferences(files({ "index.js": "code" }), prevPkg, prev, prevPkg)).toEqual(["package.json missing in V"]);
    expect(codeDifferences(files({ "package.json": "b" }), null, prev, prevPkg)).toEqual(["package.json unreadable"]);
  });
});

describe("names", () => {
  const record = (affected: unknown[]) => ({ affected });
  it("names listed versions of the same npm package only", () => {
    const r = record([{ package: { ecosystem: "npm", name: "p" }, versions: ["1.0.1"] }]);
    expect(names(r, "p", "1.0.1")).toBe(true);
    expect(names(r, "p", "1.0.0")).toBe(false);
    expect(names(r, "q", "1.0.1")).toBe(false);
  });
  it("names every version in a range from 0, and none outside a fixed range", () => {
    expect(names(record([{ package: { ecosystem: "npm", name: "p" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }] }] }]), "p", "0.0.1")).toBe(true);
    const fixed = record([{ package: { ecosystem: "npm", name: "p" }, ranges: [{ type: "SEMVER", events: [{ introduced: "1.0.0" }, { fixed: "1.2.0" }] }] }]);
    expect(names(fixed, "p", "1.1.9")).toBe(true);
    expect(names(fixed, "p", "1.2.0")).toBe(false);
    expect(names(fixed, "p", "0.9.0")).toBe(false);
    const last = record([{ package: { ecosystem: "npm", name: "p" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "2.0.0" }] }] }]);
    expect(names(last, "p", "2.0.0")).toBe(true);
    expect(names(last, "p", "2.0.1")).toBe(false);
  });
  it("counts a version as named when a range event cannot be placed", () => {
    expect(names(record([{ package: { ecosystem: "npm", name: "p" }, ranges: [{ type: "SEMVER", events: [{ introduced: "not-a-version" }] }] }]), "p", "1.0.0")).toBe(true);
  });
});
