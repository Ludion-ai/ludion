// Every reader function that runs a pattern over file text, fed a 4 MiB adversarial string: long runs of the
// characters a pattern matches, then one it does not. Each must finish in under a second (#189 round 4: two
// end-anchored runs, `[...]+$` in setup.cfg handling and `/\/+$/` on exclude entries, were quadratic).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGoMod } from "../src/security/readonly/go.ts";
import { literalMembers } from "../src/security/readonly/members.ts";
import { normalizeName, parseRequirements, readPython, setupCfgDependencySections, toolDependencySettings } from "../src/security/readonly/python.ts";
import { parseCargoLock, readRust } from "../src/security/readonly/rust.ts";

const SIZE = 4 * 1024 * 1024 - 64;
const run = (char: string, size = SIZE) => char.repeat(size);
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-redos-"));
  for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); }
  return root;
}
const attempt = (fn: () => unknown) => { try { return fn(); } catch (error) { return error; } };

describe("literal members are trimmed with string code", () => {
  it("drops trailing slashes and leading ./, and never reads exclude entries", () => {
    expect(literalMembers(["./app/", "app", "app//", "././app", "./", "."], undefined)).toEqual({ dirs: ["app"], unchecked: false });
    expect(literalMembers(["app"], ["app"])).toEqual({ dirs: ["app"], unchecked: true });
    expect(literalMembers(["app"], [])).toEqual({ dirs: ["app"], unchecked: false });
  });
});

describe("no reader pattern is quadratic on 4 MiB of file text", () => {
  it.each<[string, () => unknown]>([
    // setup.cfg headers: inner whitespace (the former trailing [\s...]+$), a leading run, an unclosed header.
    ["setup.cfg: one line, whitespace inside", () => expect(setupCfgDependencySections(`x${run(" ")}y`)).toEqual([])],
    ["setup.cfg: one line, control characters inside", () => expect(setupCfgDependencySections(`x${run("\u001c")}y`)).toEqual([])],
    ["setup.cfg: a leading run before a header", () => expect(setupCfgDependencySections(`${run(" ")}[options]`)).toEqual(["[options]"])],
    ["setup.cfg: an unclosed header", () => expect(setupCfgDependencySections(`[${run("x")}`)).toEqual([])],
    // Workspace members: an exclude entry of slashes (the former /\/+$/), and 4 MiB of 500-character members.
    ["members: one exclude entry of slashes", () => expect(literalMembers([], [`a${run("/")}x`])).toEqual({ dirs: [], unchecked: true })],
    ["members: one member of slashes", () => expect(literalMembers([`a${run("/")}x`], undefined)).toEqual({ dirs: [], unchecked: true })],
    ["members: 4 MiB of members ending in slashes", () => expect(literalMembers(Array.from({ length: SIZE / 500 }, (_, i) => `m${i % 900}${"/".repeat(490)}`), undefined).dirs).toHaveLength(900)],
    ["members: 4 MiB of members with inner slashes", () => expect(literalMembers(Array.from({ length: SIZE / 500 }, () => `a${"/".repeat(497)}x`), undefined).dirs).toHaveLength(1)],
    // The whole readers, on the review's folders (H2: a Cargo exclude entry; H3: a uv workspace exclude entry).
    ["readRust: a Cargo.toml exclude entry of slashes", () => expect(readRust(project({ "Cargo.lock": 'version = 4\n\n[[package]]\nname = "app"\nversion = "0.1.0"\n', "Cargo.toml": `[workspace]\nmembers = []\nexclude = ["a${run("/", SIZE - 64)}x"]\n` }))!.limitations).toHaveLength(1)],
    ["readPython: a [tool.uv.workspace] exclude entry of slashes", () => expect(readPython(project({
      "uv.lock": 'version = 1\n\n[[package]]\nname = "app"\nversion = "0.1.0"\nsource = { editable = "." }\n',
      "pyproject.toml": `[project]\nname = "app"\n\n[tool.uv.workspace]\nexclude = ["a${run("/", SIZE - 128)}x"]\n`,
    }))!.limitations).toHaveLength(1)],
    ["readPython: a setup.cfg of one whitespace line", () => expect(readPython(project({ "setup.cfg": `x${run(" ")}y` }))!.limitations).toEqual([])],
    // The other patterns over file text, with the runs they match.
    ["toolDependencySettings: a long tool key", () => expect(toolDependencySettings(`[tool.x]\n${run("d", SIZE - 32)}x = 1\n`)).toEqual([])],
    ["normalizeName: a run of separators", () => expect(normalizeName(`${run("-")}a`)).toBe("-a")],
    ["parseRequirements: one line of spaces", () => expect(parseRequirements(`x${run(" ")}y`).packages).toEqual([])],
    ["parseRequirements: a run of backslash continuations", () => expect(parseRequirements(`${run("\\\n", SIZE / 2)}x`).packages).toEqual([])],
    ["parseGoMod: a module path ending in a run of digits after /v", () => expect(attempt(() => parseGoMod(`module example.com/m\n\nrequire example.com/a/v${run("1", SIZE - 64)}x v1.0.0\n`))).toBeInstanceOf(Error)],
    ["parseGoMod: a gopkg.in path ending in a run after .v", () => expect(attempt(() => parseGoMod(`module example.com/m\n\nrequire gopkg.in/a.v${run("1", SIZE - 64)}x v1.0.0\n`))).toBeInstanceOf(Error)],
    ["parseGoMod: a comment of whitespace", () => expect(parseGoMod(`module example.com/m\n\ngo 1.22\n// ${run(" ", SIZE - 64)}x\n`).packages).toEqual([])],
    ["parseCargoLock: a git source with a long #fragment", () => expect(attempt(() => parseCargoLock(`version = 4\n\n[[package]]\nname = "a"\nversion = "1.0.0"\nsource = "git+https://example.com/a#${run("#", SIZE - 128)}x"\n`))).toBeInstanceOf(Error)],
    ["parseCargoLock: a long table header", () => expect(attempt(() => parseCargoLock(`version = 4\n\n[[${run("a", SIZE - 64)}!`))).toBeInstanceOf(Error)],
  ])("%s", (_name, fn) => {
    const started = performance.now();
    fn();
    expect(performance.now() - started).toBeLessThan(1000);
  }, 30_000);
});
