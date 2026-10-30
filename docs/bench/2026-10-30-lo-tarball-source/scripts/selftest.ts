// Checks of lo.ts on made-up inputs, run before the comparison (run.sh). Plain assertions, no network.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { built, compare, githubOf, hashBytes, packageDir, parsePax, readTar, releaseTag, repositoryOf, stripTop, TarReader, tagCandidates, tagsFromRefs, type Files, type Source } from "./lo.ts";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

function header(name: string, size: number, type: string, link = "", prefix = ""): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, "utf8");
  h.write(size.toString(8).padStart(11, "0"), 124, 12, "ascii");
  h.write(type, 156, 1, "ascii");
  h.write(link, 157, 100, "utf8");
  h.write("ustar\0", 257, 6, "ascii");
  h.write(prefix, 345, 155, "utf8");
  return h;
}
const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
const entry = (name: string, body: string | Buffer, type = "0", prefix = "") => { const b = Buffer.from(body); return Buffer.concat([header(name, b.length, type, "", prefix), pad(b)]); };
const pax = (kv: Record<string, string>) => {
  const recs = Object.entries(kv).map(([k, v]) => { const base = ` ${k}=${v}\n`; let n = base.length + 1; while (`${n}${base}`.length !== n) n++; return `${n}${base}`; }).join("");
  return entry("pax", recs, "x");
};
const end = Buffer.alloc(1024);

// stripTop
assert.equal(stripTop("package/./dist/index.js"), "dist/index.js");
assert.equal(stripTop("./package/a.js"), "a.js");
assert.equal(stripTop("repo-abc/x/../y"), "x/../y");

// A tar with ustar prefix, pax path, GNU long name, link, directory, a global header, and CRLF across chunks.
const crlf = "a\r\nb\r\n";
const tar = Buffer.concat([
  entry("pax_global_header", "52 comment=0123456789abcdef0123456789abcdef01234567\n", "g"),
  entry("package/", "", "5"),
  entry("package/package.json", JSON.stringify({ name: "x" })),
  entry("package/lib/a.js", crlf),
  entry("c.js", "cc", "0", "package/deep"),
  pax({ path: "package/long/" + "n".repeat(120) + ".js" }),
  entry("ignored-name", "long"),
  entry("././@LongLink", "package/gnu/" + "g".repeat(110) + ".js", "L"),
  entry("ignored-too", "gnu"),
  Buffer.concat([header("package/link.js", 0, "2", "lib/a.js")]),
  end,
]);
for (const split of [1, 7, 511, 512, 513, tar.length]) {
  const r = new TarReader(1 << 20);
  for (let at = 0; at < tar.length; at += split) r.push(tar.subarray(at, at + split));
  r.end();
  assert.deepEqual([...r.files.keys()].sort(), ["deep/c.js", "gnu/" + "g".repeat(110) + ".js", "lib/a.js", "link.js", "long/" + "n".repeat(120) + ".js", "package.json"].sort(), `split ${split}`);
  assert.equal(r.files.get("lib/a.js")!.sha256, sha(crlf));
  assert.equal(r.files.get("lib/a.js")!.eol, sha("a\nb\n"), `eol at split ${split}`);
  assert.equal(r.files.get("link.js")!.sha256, sha("link:lib/a.js"));
  assert.equal(r.kept.get("package.json"), JSON.stringify({ name: "x" }));
}
// A lone CR stays, a CR at a chunk's end followed by LF in the next is dropped.
{
  const r = new TarReader(1 << 20);
  const t = Buffer.concat([entry("p/a", "x\ry\r"), end]);
  r.push(t); r.end();
  assert.equal(r.files.get("a")!.eol, sha("x\ry\r"));
}
// Size limit and truncation.
assert.throws(() => readTar(Buffer.concat([entry("p/a", "12345"), end]), 4), /size limit/);
assert.throws(() => readTar(entry("p/a", "x".repeat(600)).subarray(0, 700)), /truncated/);
assert.deepEqual(parsePax(Buffer.from("12 path=a/b\n")), { path: "a/b" });
assert.equal(hashBytes(Buffer.from("a\r\n")).eol, sha("a\n"));

// githubOf / repositoryOf
const ok = (s: string) => { const r = githubOf(s); return r.ok ? `${r.owner}/${r.repo}` : r.why; };
for (const s of ["o/r", "github:o/r", "https://github.com/o/r", "http://github.com/o/r", "git+https://github.com/o/r.git", "git://github.com/o/r.git", "git+ssh://git@github.com/o/r.git", "ssh://git@github.com/o/r", "git@github.com:o/r.git", "https://github.com/o/r/", "https://github.com/o/r.git#main", "https://www.github.com/o/r"]) assert.equal(ok(s), "o/r", s);
for (const s of ["https://gitlab.com/o/r", "gitlab:o/r", "git+https://bitbucket.org/o/r.git"]) assert.equal(ok(s), "not GitHub", s);
for (const s of ["https://github.com/o/r/tree/main/packages/x", "https://github.com/o", "git@github.com/o/r", "https://github.com:o/r", "just text", "git+http://github.com/o/r"]) assert.equal(ok(s), "repository not understood", s);
assert.equal(ok(""), "no repository");
assert.deepEqual(repositoryOf({}), { ok: false, why: "no repository" });
assert.deepEqual(repositoryOf({ repository: { type: "git", url: "https://github.com/o/r", directory: "./packages/x/" } }), { ok: true, owner: "o", repo: "r", directory: "packages/x" });
assert.deepEqual(repositoryOf({ repository: { directory: "x" } }), { ok: false, why: "no repository" });

// Tags
assert.deepEqual(tagCandidates("@s/p", "1.2.3"), ["v1.2.3", "1.2.3", "@s/p@1.2.3", "p@1.2.3", "p-v1.2.3", "p-1.2.3", "p/v1.2.3", "p/1.2.3"]);
const c1 = "1".repeat(40), c2 = "2".repeat(40), c3 = "3".repeat(40);
const advert = `001e# service=git-upload-pack\n0000015b${c1} HEAD\0multi_ack thin-pack\n003f${c2} refs/tags/v1.2.3\n0042${c3} refs/tags/v1.2.3^{}\n0040${c1} refs/tags/p@1.2.4\n0000`;
const tags = tagsFromRefs(advert);
assert.equal(tags.get("v1.2.3"), c3);
assert.equal(tags.get("p@1.2.4"), c1);
assert.deepEqual(releaseTag(tags, "@s/p", "1.2.3"), { tag: "v1.2.3", form: 1, commit: c3 });
assert.deepEqual(releaseTag(tags, "@s/p", "1.2.4"), { tag: "p@1.2.4", form: 4, commit: c1 });
assert.equal(releaseTag(tags, "@s/p", "9.9.9"), null);

// Package directory
const e = (s: string) => ({ ...hashBytes(Buffer.from(s)) });
const src = (files: Record<string, string>): Source => {
  const f: Files = new Map(Object.entries(files).map(([p, s]) => [p, e(s)]));
  return { files: f, kept: new Map(Object.entries(files).filter(([p]) => p.split("/").pop() === "package.json")) };
};
const mono = src({ "package.json": JSON.stringify({ name: "root" }), "packages/a/package.json": JSON.stringify({ name: "a", scripts: { build: "tsc" } }), "node_modules/a/package.json": JSON.stringify({ name: "a" }), "packages/a/index.js": "A", "README.md": "R", "packages/a/src/x.ts": "X" });
assert.deepEqual(packageDir(mono, "a", null), { ok: true, dir: "packages/a", how: "search" });
assert.deepEqual(packageDir(mono, "root", null), { ok: true, dir: "", how: "root" });
assert.deepEqual(packageDir(mono, "a", "packages/a"), { ok: true, dir: "packages/a", how: "directory" });
assert.deepEqual(packageDir(mono, "a", "packages/b"), { ok: false, why: "directory not in source" });
assert.deepEqual(packageDir(mono, "zz", null), { ok: false, why: "package directory not found" });
const twice = src({ "a/package.json": JSON.stringify({ name: "a" }), "b/package.json": JSON.stringify({ name: "a" }) });
assert.deepEqual(packageDir(twice, "a", null), { ok: false, why: "package directory not found" });

// Comparing
const ver = (files: Record<string, string>, pkg: Record<string, unknown> = { name: "a" }) => ({ files: new Map(Object.entries(files).map(([p, s]) => [p, e(s)])) as Files, pkg });
const spkg = { name: "a", scripts: { build: "tsc" } };
let c = compare(ver({ "package.json": "different bytes", "index.js": "A", "README.md": "R" }), mono, "packages/a", spkg);
assert.equal(c.outcome, "match"); assert.equal(c.files, 2); assert.equal(c.identical, 2);
c = compare(ver({ "index.js": "A!", "dist/out.js": "D", "x.ts": "X" }), mono, "packages/a", spkg);
assert.equal(c.outcome, "differs"); assert.equal(c.different, 1); assert.equal(c.absent, 2); assert.equal(c.absentUnderMissingTop, 1);
assert.deepEqual(c.differentPaths, ["index.js"]); assert.deepEqual(c.absentPaths, ["dist/out.js", "x.ts"]);
c = compare(ver({ "index.js": "A", "src/new.ts": "N" }), mono, "packages/a", spkg);
assert.equal(c.outcome, "absent files only"); assert.equal(c.absentUnderMissingTop, 0);
c = compare(ver({ "index.js": "A" }, { name: "a", scripts: { postinstall: "node x" } }), mono, "packages/a", spkg);
assert.equal(c.outcome, "differs"); assert.deepEqual(c.packageJson, { installScripts: true, dependencyNames: false });
c = compare(ver({ "index.js": "A" }, { name: "a", dependencies: { q: "1" } }), mono, "packages/a", { ...spkg, devDependencies: { q: "1" } });
assert.equal(c.outcome, "differs"); assert.deepEqual(c.packageJson, { installScripts: false, dependencyNames: true });
c = compare(ver({ "index.js": "A" }, { name: "a", dependencies: { q: "2.0.0" }, optionalDependencies: { r: "1" } }), mono, "packages/a", { ...spkg, dependencies: { q: "workspace:*" }, optionalDependencies: { r: "^1" } });
assert.equal(c.outcome, "match");
// CRLF: different bytes, identical after normalising; null when a side has no normalised hash.
const crSrc = src({ "package.json": JSON.stringify({ name: "a" }), "f.js": "a\nb\n" });
c = compare(ver({ "f.js": "a\r\nb\r\n" }), crSrc, "", { name: "a" });
assert.equal(c.outcome, "differs"); assert.equal(c.differentButEolIdentical, 1);
c = compare({ files: new Map([["f.js", { sha256: sha("zz"), eol: null, size: 2 }]]), pkg: { name: "a" } }, crSrc, "", { name: "a" });
assert.equal(c.differentButEolIdentical, null);
// The root fallback applies only at the version's root and only to the listed names.
c = compare(ver({ "docs/README.md": "R" }), mono, "packages/a", spkg);
assert.equal(c.absent, 1);
c = compare(ver({ "OTHER.md": "R" }), src({ "OTHER.md": "R", "p/package.json": "{}" }), "p", spkg);
assert.equal(c.absent, 1);

// Built
assert.equal(built({ scripts: { build: "x" } }), true);
assert.equal(built({ scripts: { prepublishOnly: "x" } }), true);
assert.equal(built({ scripts: { prepare: "husky install" } }), false);
assert.equal(built({ scripts: { prepare: "tsc" } }), true);
assert.equal(built({ scripts: { test: "x" } }), false);
assert.equal(built({}), false);

console.log("selftest: all checks passed");
