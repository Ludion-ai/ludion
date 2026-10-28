import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGoMod, readGo } from "../src/security/readonly/go.ts";

const mod = (body: string) => `module example.com/app\n\n${body}\n`;
/** Always there when stdlib and toolchain come from the toolchain line: it is not necessarily the Go that builds. */
const CHECKED_AT = (version: string) => `stdlib and toolchain were checked at ${version}, go.mod's toolchain line, but that line is only a minimum under GOTOOLCHAIN=auto and is ignored under GOTOOLCHAIN=local (which the official golang Docker images set). The Go that actually builds may be another version, whose standard library and go command advisories may be missing.`;
const UNCHECKED = "The Go toolchain in use is unknown, so the Go standard library and go command (stdlib, toolchain) were not checked.";

describe("go.mod require list", () => {
  it("reads single-line and block requires, Go's own // indirect rule, and quoted paths", () => {
    const { packages, limitations } = parseGoMod(mod(`go 1.22.3

toolchain go1.22.5

require (
\tgithub.com/dgrijalva/jwt-go v3.2.0+incompatible
\tgolang.org/x/text v0.3.5 // indirect
\tgolang.org/x/crypto v0.0.0-20200622213623-75b288015ac9 // indirect; pulled in by x/net
\tgolang.org/x/net v0.3.6-0.20210220033129-8f690f22cf1c//indirect

\t// a comment line inside the block
\texample.com/notes v1.0.0 // indirect dependency of nothing (not Go's marker)
\t"example.com/quoted" "v1.1.0" // indirect
\texample.com/major/v2 v2.1.0
\tgopkg.in/yaml.v2 v2.4.0
\tgopkg.in/check.v1 v0.0.0-20161208181325-20d25e280405
\tgopkg.in/old.v0 v0.1.0
\tgopkg.in/edge.v3-unstable v3.0.0
)

require github.com/single/line v1.2.3 // a comment`));
    expect(packages).toEqual([
      { name: "github.com/dgrijalva/jwt-go", version: "v3.2.0+incompatible", direct: true },
      { name: "golang.org/x/text", version: "v0.3.5", direct: false },
      { name: "golang.org/x/crypto", version: "v0.0.0-20200622213623-75b288015ac9", direct: false },
      { name: "golang.org/x/net", version: "v0.3.6-0.20210220033129-8f690f22cf1c", direct: false },
      { name: "example.com/notes", version: "v1.0.0", direct: true },
      { name: "example.com/quoted", version: "v1.1.0", direct: false },
      { name: "example.com/major/v2", version: "v2.1.0", direct: true },
      { name: "gopkg.in/yaml.v2", version: "v2.4.0", direct: true },
      { name: "gopkg.in/check.v1", version: "v0.0.0-20161208181325-20d25e280405", direct: true },
      { name: "gopkg.in/old.v0", version: "v0.1.0", direct: true },
      { name: "gopkg.in/edge.v3-unstable", version: "v3.0.0", direct: true },
      { name: "github.com/single/line", version: "v1.2.3", direct: true },
      { name: "stdlib", version: "1.22.5", direct: true },
      { name: "toolchain", version: "1.22.5", direct: true },
    ]);
    expect(limitations).toEqual([CHECKED_AT("1.22.5")]);
  });

  it("does not treat // inside a quoted string as a comment", () => {
    // Were the // a comment, the string would be unterminated; it is a (bad) module path instead.
    expect(() => parseGoMod(mod(`require "example.com/a // b" v1.0.0`))).toThrow(/line 3: invalid module path "example.com\/a \/\/ b"/);
    // And a comment directly after a quoted value still ends the line.
    expect(parseGoMod(mod(`toolchain go1.22.5\nrequire "example.com/a" v1.0.0// indirect`)).packages[0]).toEqual({ name: "example.com/a", version: "v1.0.0", direct: false });
  });

  it("accepts CRLF line endings, empty blocks and the directives that do not change the inventory", () => {
    const text = `module example.com/app // Deprecated: use v2\r\ngo 1.23.0\r\ntoolchain go1.23.2\r\nrequire ()\r\nrequire (\r\n\texample.com/a v1.0.0\r\n)\r\n`
      + "godebug default=go1.21\ngodebug (\n\tpanicnil=1\n)\ntool golang.org/x/tools/cmd/stringer\nignore ./node_modules\n";
    expect(parseGoMod(text)).toEqual({ packages: [
      { name: "example.com/a", version: "v1.0.0", direct: true },
      { name: "stdlib", version: "1.23.2", direct: true },
      { name: "toolchain", version: "1.23.2", direct: true },
    ], limitations: [CHECKED_AT("1.23.2")] });
  });

  it("rejects a byte-order mark, as Go does", () => {
    expect(() => parseGoMod("\uFEFFmodule example.com/app\n")).toThrow(/line 1: unexpected character/);
  });

  it("parses retract and other excludes without changing the inventory", () => {
    const text = mod(`go 1.22.0
toolchain go1.22.5
require golang.org/x/text v0.3.5
exclude golang.org/x/text v0.3.4
exclude (
\tgolang.org/x/net v0.1.0
)
retract v1.0.1 // published by mistake
retract [v1.1.0, v1.1.9]
retract (
\tv1.2.0
\t[v1.3.0,v1.3.5] // rationale
)`);
    expect(parseGoMod(text)).toEqual({ packages: [
      { name: "golang.org/x/text", version: "v0.3.5", direct: true },
      { name: "stdlib", version: "1.22.5", direct: true },
      { name: "toolchain", version: "1.22.5", direct: true },
    ], limitations: [CHECKED_AT("1.22.5")] });
  });

  it("drops a requirement on a version go.mod excludes, as Go does, and says so", () => {
    // The review's case: Go prints "dropping requirement on excluded version example.com/a v1.3.0".
    for (const text of [
      mod("go 1.22.0\ntoolchain go1.22.5\nrequire example.com/a v1.3.0\nexclude example.com/a v1.3.0"),
      mod("go 1.22.0\ntoolchain go1.22.5\nexclude (\n\texample.com/a v1.3.0\n)\nrequire (\n\texample.com/a v1.3.0 // indirect\n\texample.com/b v1.0.0\n)\nreplace example.com/a => ./a"),
    ]) {
      const { packages, limitations } = parseGoMod(text);
      expect(packages.map(p => p.name)).not.toContain("example.com/a");
      expect(limitations[0]).toBe("example.com/a v1.3.0 is excluded by go.mod's own exclude directive, so Go drops this requirement; it was left out, and any other version Go might use instead was not checked.");
    }
  });
});

describe("go.mod replace directives", () => {
  const text = mod(`go 1.21.0
toolchain go1.21.4
require (
\texample.com/local v1.0.0
\texample.com/forked v1.2.0 // indirect
\texample.com/pinned v1.3.0
\texample.com/other-version v1.4.0
\texample/nodot v0.0.0
)
replace example.com/local => ../local
replace (
\texample.com/forked => github.com/someone/forked v1.2.1
\texample.com/pinned v1.3.0 => ./pinned
\texample.com/pinned => example.com/pinned v1.3.9
\texample.com/other-version v1.0.0 => ./unused
\texample/nodot => ./nodot
\texample.com/not-required => C:\\src\\x
)`);

  it("leaves every replaced requirement out and names it, the replacement module too, in limitations", () => {
    const { packages, limitations } = parseGoMod(text);
    expect(packages.map(p => `${p.name}@${p.version}`)).toEqual(["example.com/other-version@v1.4.0", "stdlib@1.21.4", "toolchain@1.21.4"]);
    expect(limitations).toEqual([
      "example.com/local v1.0.0 is replaced by a local directory; its code is not a published module version, so it was not checked.",
      "example.com/forked v1.2.0 is replaced by github.com/someone/forked v1.2.1; Ludion does not substitute replacements, so the replacement was not checked, and example.com/forked v1.2.0, which the build does not use, was left out.",
      // The replacement for this exact version wins over the one for every version.
      "example.com/pinned v1.3.0 is replaced by a local directory; its code is not a published module version, so it was not checked.",
      "example/nodot v0.0.0 is replaced by a local directory; its code is not a published module version, so it was not checked.",
      CHECKED_AT("1.21.4"),
    ]);
    // Neither the replacement module nor the original is sent to OSV.
    expect(packages.some(p => p.name.includes("forked"))).toBe(false);
  });

  it("does not query a module path Go could not download, such as a stdlib look-alike", () => {
    const { packages, limitations } = parseGoMod(mod(`go 1.22.0\ntoolchain go1.22.5\nrequire stdlib v1.0.0`));
    expect(packages).toEqual([{ name: "stdlib", version: "1.22.5", direct: true }, { name: "toolchain", version: "1.22.5", direct: true }]);
    expect(limitations).toEqual(["stdlib v1.0.0 has no dot in its first path element, so it is not a published module path; it was not checked.", CHECKED_AT("1.22.5")]);
  });

  it("rejects malformed replacements", () => {
    expect(() => parseGoMod(mod("replace example.com/a => example.com/b"))).toThrow(/line 3: a replacement module needs a version/);
    expect(() => parseGoMod(mod("replace example.com/a => ./a v1.0.0"))).toThrow(/cannot have a version/);
    expect(() => parseGoMod(mod("replace example.com/a v1.0.0"))).toThrow(/expected replace/);
    expect(() => parseGoMod(mod("replace example.com/a v1.0.0 => example.com/b v1.0.1 extra"))).toThrow(/expected replace/);
    expect(() => parseGoMod(mod("replace example.com/a => example.com/b@v1.0.1"))).toThrow(/needs a version/);
    expect(() => parseGoMod(mod("replace example.com/a v2.0.0 => ./a"))).toThrow(/invalid version v2.0.0 for example.com\/a: should be v0 or v1, not v2/);
    expect(() => parseGoMod(mod("replace example.com/a/v1 => ./a"))).toThrow(/invalid module path "example.com\/a\/v1"/);
    expect(() => parseGoMod(mod("replace example.com/a => ./a\nreplace example.com/a => ./b"))).toThrow(/line 4: conflicting replacements for example.com\/a/);
    // The same replacement twice is harmless, as in Go.
    expect(() => parseGoMod(mod("replace example.com/a => ./a\nreplace example.com/a => ./a"))).not.toThrow();
  });
});

describe("go and toolchain directives", () => {
  const PRUNING = "before Go 1.17 the require list need not name every module the build uses (module graph pruning is not in effect), so some modules may be missing from this inventory.";

  it("says an old or missing go directive may leave modules out", () => {
    expect(parseGoMod(mod("go 1.16\ntoolchain go1.21.0")).limitations).toEqual([`go.mod declares go 1.16; ${PRUNING}`, CHECKED_AT("1.21.0")]);
    expect(parseGoMod(mod("toolchain go1.21.0")).limitations).toEqual([`go.mod has no go directive, so Go treats it as go 1.16; ${PRUNING}`, CHECKED_AT("1.21.0")]);
    expect(parseGoMod(mod("go 1.17\ntoolchain go1.21.0")).limitations).toEqual([CHECKED_AT("1.21.0")]);
  });

  it("checks the standard library only at a toolchain line's release, and always says that may not be the Go that builds", () => {
    const absent = parseGoMod(mod("go 1.22.3\nrequire example.com/a v1.0.0"));
    expect(absent.packages.map(p => p.name)).toEqual(["example.com/a"]);
    expect(absent.limitations).toEqual([`go.mod has no toolchain line, and its go 1.22.3 line is a minimum, not the toolchain in use. ${UNCHECKED}`]);
    expect(parseGoMod("module example.com/app\n").limitations).toContain(`go.mod has no toolchain line. ${UNCHECKED}`);

    // The review's case: built with GOTOOLCHAIN=local in a golang:1.22.0 image, the binary has 1.22.0's stdlib.
    const declared = parseGoMod(mod("go 1.22.0\ntoolchain go1.25.3"));
    expect(declared.packages).toEqual([{ name: "stdlib", version: "1.25.3", direct: true }, { name: "toolchain", version: "1.25.3", direct: true }]);
    expect(declared.limitations).toEqual([CHECKED_AT("1.25.3")]);
    expect(parseGoMod(mod("go 1.22rc1\ntoolchain go1.22.0")).packages).toEqual([{ name: "stdlib", version: "1.22.0", direct: true }, { name: "toolchain", version: "1.22.0", direct: true }]);

    for (const [line, why] of [
      ["toolchain default", "go.mod says toolchain default, which names no version."],
      ["toolchain go1.22rc2", "go.mod's toolchain go1.22rc2 is not a release name of the form goX.Y.Z."],
      ["toolchain go1.22.5-custom", "go.mod's toolchain go1.22.5-custom is not a release name of the form goX.Y.Z."],
      ["toolchain go1.21.9", "go.mod's toolchain go1.21.9 is older than its go 1.22.3 line."],
    ] as const) {
      const { packages, limitations } = parseGoMod(mod(`go 1.22.3\n${line}`));
      expect(packages).toEqual([]);
      expect(limitations).toEqual([`${why} ${UNCHECKED}`]);
    }
  });
});

describe("malformed go.mod", () => {
  it.each([
    ["/* block comment */", /line 3: go.mod files must use \/\/ comments/],
    ["require example.com/a v1.0.0 /* x */", /must use \/\/ comments/],
    ["require (\n\texample.com/a v1.0.0", /line 3: the require block is never closed/],
    ["require (\n\texample.com/a v1.0.0\n) trailing", /line 5: expected a newline after the closing parenthesis/],
    ["require ( example.com/a v1.0.0 )", /block must open with a directive name/],
    ["require example.com/a", /line 3: expected require <module path> <version>/],
    ["require example.com/a v1.0.0 extra", /expected require/],
    ["require (\n\texample.com/a\n)", /line 4: expected require/],
    ["require example.com/a 1.0.0", /invalid module version "1.0.0"/],
    ["require example.com/a v1.2", /invalid module version "v1.2"/],
    ["require example.com/a latest", /invalid module version/],
    ["require example.com/a v1.0.0+meta", /invalid module version/],
    ["require example.com/a v01.0.0", /invalid module version/],
    ["require .example.com/a v1.0.0", /invalid module path/],
    ["require example.com/a/ v1.0.0", /invalid module path/],
    // As in Go, // starts a comment even inside a word, leaving one argument.
    ["require example.com//a v1.0.0", /expected require/],
    // Go's module.CheckPathMajor: the version's major must match the path's major-version suffix.
    ["require example.com/a v2.0.0", /invalid version v2.0.0 for example.com\/a: should be v0 or v1, not v2/],
    ["require example.com/a/v2 v1.0.0", /invalid version v1.0.0 for example.com\/a\/v2: should be v2, not v1/],
    ["require example.com/a/v2 v0.0.0-20200101000000-abcdef123456", /should be v2, not v0/],
    ["require gopkg.in/yaml.v2 v3.0.0", /invalid version v3.0.0 for gopkg.in\/yaml.v2: should be v2, not v3/],
    ["exclude example.com/a v2.0.0", /should be v0 or v1, not v2/],
    ["require example.com/a/v1 v1.0.0", /invalid module path "example.com\/a\/v1" \(its major-version suffix/],
    ["require example.com/a/v0 v0.1.0", /invalid module path/],
    ["require example.com/a/v2.1 v2.1.0", /invalid module path/],
    ["require gopkg.in/yaml v1.0.0", /invalid module path "gopkg.in\/yaml"/],
    ["require gopkg.in/yaml.v01 v1.0.0", /invalid module path/],
    ["require gopkg.in/yaml.v0-unstable v0.1.0", /invalid module path/],
    ["require example.com/a\u00a0v1.0.0", /unexpected character/],
    ["require \"example.com/a v1.0.0", /unterminated quoted string/],
    ["require \"example.com/\\a\" v1.0.0", /unsupported escape/],
    ["require `example.com/a` v1.0.0", /backquoted strings/],
    ["require example.com/a'b v1.0.0", /cannot contain a quote/],
    ["require example.com/a v1.0.0\nrequire example.com/a v1.0.1", /line 4: example.com\/a is required more than once/],
    [")", /expected a directive/],
    ["go 1.21\ngo 1.22", /line 4: repeated go directive/],
    ["go 1.21.x", /invalid go version "1.21.x"/],
    ["go \"1.21\"", /invalid go version/],
    ["go (\n\t1.21\n)", /go cannot be written as a block/],
    ["toolchain go1.22.5 extra", /expected toolchain <name>/],
    ["toolchain 1.22.5", /invalid toolchain "1.22.5"/],
    ["toolchain go1.22.5\ntoolchain go1.22.6", /repeated toolchain/],
    ["exclude golang.org/x/text", /expected exclude/],
    ["exclude golang.org/x/text latest", /invalid module version/],
    ["retract", /expected retract/],
    ["retract [v1.0.0 v1.0.1]", /expected retract \[<low>, <high>\]/],
    ["retract [v1.0.0, v1.0.x]", /invalid module version/],
    ["retract v1.0.0 v1.0.1", /expected retract/],
    ["godebug panicnil", /expected godebug <key>=<value>/],
    ["module example.com/other", /line 3: repeated module directive/],
  ])("rejects %j", (body, error) => {
    expect(() => parseGoMod(mod(body))).toThrow(error);
  });

  it("requires a module directive", () => {
    expect(() => parseGoMod("go 1.22.0\n")).toThrow("go.mod has no module directive.");
  });

  it("lists directives it does not know in one bounded limitation instead of guessing what they mean", () => {
    expect(parseGoMod(mod("go 1.22.0\ntoolchain go1.22.5\nfrobnicate example.com/a v1.0.0\nfrobnicate (\n\tx\n)")).limitations)
      .toEqual([CHECKED_AT("1.22.5"), "go.mod has a directive Ludion does not read: frobnicate (line 5). It was ignored and may change the build."]);
    const many = parseGoMod(mod(`go 1.22.0\ntoolchain go1.22.5\n${Array.from({ length: 50_000 }, (_, i) => `frob${i} x`).join("\n")}`)).limitations;
    expect(many).toHaveLength(2);
    expect(many[1]).toBe(`go.mod has 50000 directives Ludion does not read: ${Array.from({ length: 10 }, (_, i) => `frob${i} (line ${i + 5})`).join(", ")}, and 49990 more. They were ignored and may change the build.`);
  });

  it("caps the inventory at 2,000 packages and the requirements, which bound the per-module limitations, at 2,000", () => {
    const requires = (n: number, replaced = false) => mod(`go 1.22.0\ntoolchain go1.22.5\nrequire (\n${Array.from({ length: n }, (_, i) => `\texample.com/m${i} v1.0.0`).join("\n")}\n)\n`
      + (replaced ? Array.from({ length: n }, (_, i) => `replace example.com/m${i} => ./m${i}`).join("\n") : ""));
    expect(parseGoMod(requires(1998)).packages).toHaveLength(2000);
    expect(() => parseGoMod(requires(1999))).toThrow(/exceeds 2,000/);
    // Every requirement replaced: no packages but stdlib and toolchain, and at most 2,000 per-module limitations.
    const replaced = parseGoMod(requires(2000, true));
    expect(replaced.packages.map(p => p.name)).toEqual(["stdlib", "toolchain"]);
    expect(replaced.limitations).toHaveLength(2001);
    expect(() => parseGoMod(requires(2001, true))).toThrow(/line 2006: more than 2,000 requirements/);
  });
});

describe("readGo", () => {
  const root = () => mkdtempSync(join(tmpdir(), "ludion-readonly-go-"));
  const GO_MOD = mod("go 1.22.3\ntoolchain go1.22.5\nrequire golang.org/x/text v0.3.5 // indirect");

  it("returns null without a go.mod", () => {
    const dir = root();
    writeFileSync(join(dir, "go.sum"), "golang.org/x/text v0.3.5 h1:x=\n");
    expect(readGo(dir)).toBeNull();
  });

  it("reads go.mod only: go.sum's extra modules are not the inventory", () => {
    const dir = root();
    writeFileSync(join(dir, "go.mod"), GO_MOD);
    writeFileSync(join(dir, "go.sum"), "golang.org/x/text v0.3.5 h1:x=\ngolang.org/x/text v0.3.0/go.mod h1:y=\nexample.com/not-built v1.0.0 h1:z=\n");
    const inventory = readGo(dir)!;
    expect(inventory).toEqual({
      ecosystem: "Go", files: ["go.mod"], scope: expect.stringContaining("go.sum was not used as the inventory"),
      packages: [{ name: "golang.org/x/text", version: "v0.3.5", direct: false }, { name: "stdlib", version: "1.22.5", direct: true }, { name: "toolchain", version: "1.22.5", direct: true }],
      limitations: [CHECKED_AT("1.22.5")],
    });
    expect(inventory.scope).toContain("ignored under GOTOOLCHAIN=local");
  });

  it("says when a go.work may change the build list", () => {
    const dir = root();
    writeFileSync(join(dir, "go.mod"), GO_MOD);
    writeFileSync(join(dir, "go.work"), "go 1.22.3\nuse .\n");
    expect(readGo(dir)!.limitations).toEqual([CHECKED_AT("1.22.5"), "go.work is present; workspace modules and go.work replacements were not read, so the build list may differ from go.mod."]);
  });

  it("throws on a go.mod it cannot read instead of returning an empty inventory", () => {
    const malformed = root();
    writeFileSync(join(malformed, "go.mod"), mod("require example.com/a"));
    expect(() => readGo(malformed)).toThrow(/go.mod line 3/);

    const linked = root(), elsewhere = root();
    writeFileSync(join(elsewhere, "go.mod"), GO_MOD);
    symlinkSync(join(elsewhere, "go.mod"), join(linked, "go.mod"));
    expect(() => readGo(linked)).toThrow(/Symlinks are not supported/);

    const dangling = root();
    symlinkSync(join(dangling, "missing.mod"), join(dangling, "go.mod"));
    expect(() => readGo(dangling)).toThrow(/Symlinks are not supported/);

    const directory = root();
    mkdirSync(join(directory, "go.mod"));
    expect(() => readGo(directory)).toThrow(/regular project file/);

    const large = root();
    writeFileSync(join(large, "go.mod"), `${GO_MOD}${"// padding\n".repeat(400_000)}`);
    expect(() => readGo(large)).toThrow(/exceeds 4 MiB/);
  });
});
