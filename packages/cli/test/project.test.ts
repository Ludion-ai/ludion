// The judge reads two checkouts that come from a PR: rootPath and regularFile keep every read inside them.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { regularFile, rootPath } from "../src/security/project.ts";

const base = mkdtempSync(join(tmpdir(), "judge-project-"));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const root = join(base, "app"), outside = join(base, "outside");
mkdirSync(join(root, "sub"), { recursive: true });
mkdirSync(outside);
writeFileSync(join(root, "package.json"), "{}");
writeFileSync(join(root, "sub", "package.json"), "{}");
writeFileSync(join(outside, "secret.txt"), "x");
symlinkSync(join(outside, "secret.txt"), join(root, "linked.json"));
symlinkSync(outside, join(root, "linked-dir"));
symlinkSync(root, join(base, "root-link"));

describe("rootPath", () => {
  it("accepts a real directory", () => {
    expect(rootPath(root)).toBe(rootPath(root));
  });
  it("refuses a root that is a symbolic link, or a file", () => {
    expect(() => rootPath(join(base, "root-link"))).toThrow("real directory");
    expect(() => rootPath(join(root, "package.json"))).toThrow("real directory");
  });
});

describe("regularFile", () => {
  it("returns a regular file under the root", () => {
    expect(regularFile(rootPath(root), "sub/package.json")).toBe(join(rootPath(root), "sub", "package.json"));
  });
  it.each([
    ["an empty path", "", "project-relative"],
    ["an absolute path", join(outside, "secret.txt"), "project-relative"],
    ["a backslash", "sub\\package.json", "project-relative"],
    ["a drive or scheme colon", "C:/secret.txt", "project-relative"],
    ["a path that climbs out", "../outside/secret.txt", "escapes the project"],
    ["a path that climbs out through a subfolder", "sub/../../outside/secret.txt", "escapes the project"],
    ["the root itself", ".", "escapes the project"],
    ["a symbolic link to a file outside", "linked.json", "Symlinks"],
    ["a file under a linked directory", "linked-dir/secret.txt", "Symlinks"],
    ["a directory", "sub", "regular project file"],
  ])("refuses %s", (_, file, message) => {
    expect(() => regularFile(rootPath(root), file)).toThrow(message);
  });
});
