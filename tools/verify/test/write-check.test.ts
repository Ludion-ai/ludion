import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { checkWrites, DEFAULT_PROTECTED, diffSnapshots, matchGlob, snapshotTree, type SnapshotOptions } from "../src/write-check.ts";

function withTemp(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ludion-wc-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

function fileSymlinkCreationThrowsEperm(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "ludion-sym-"));
  try {
    writeFileSync(join(dir, "t"), "x");
    try {
      symlinkSync(join(dir, "t"), join(dir, "l"));
      return false;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "EPERM";
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const fileSymlinkEperm = fileSymlinkCreationThrowsEperm();

describe("matchGlob", () => {
  it("matches *, **, and ? without crossing a slash, and ignores case on win32", () => {
    expect(matchGlob("vitest.config.*", "vitest.config.ts")).toBe(true);
    expect(matchGlob("vitest.config.*", "src/vitest.config.ts")).toBe(false);
    expect(matchGlob("**/vitest.config.*", "src/vitest.config.ts")).toBe(true);
    expect(matchGlob("tools/verify/**", "tools/verify/src/docker.ts")).toBe(true);
    expect(matchGlob("tools/verify/**", "tools/verify")).toBe(true);
    expect(matchGlob("tools/verify/**", "tools/verify-evil/x")).toBe(false);
    expect(matchGlob("tools/verify/*", "tools/verify/src/a.ts")).toBe(false);
    expect(matchGlob("**/package.json", "package.json")).toBe(true);
    expect(matchGlob("**/package.json", "packages/app/package.json")).toBe(true);
    expect(matchGlob("**/package.json", "package.json.bak")).toBe(false);
    expect(matchGlob("**/tsconfig*.json", "tsconfig.json")).toBe(true);
    expect(matchGlob("**/tsconfig*.json", "tsconfig.app.json")).toBe(true);
    expect(matchGlob("**/tsconfig*.json", "src/tsconfig.node.json")).toBe(true);
    expect(matchGlob("**/tsconfig*.json", "tsconfig.json.bak")).toBe(false);
    expect(matchGlob("**/.npmrc", ".npmrc")).toBe(true);
    expect(matchGlob("**/.npmrc", "packages/core/.npmrc")).toBe(true);
    expect(matchGlob(".npmrc", "packages/core/.npmrc")).toBe(false);
    expect(matchGlob("**/node_modules/**", "node_modules")).toBe(true);
    expect(matchGlob("**/node_modules/**", "packages/foo/node_modules/vitest/index.js")).toBe(true);
    expect(matchGlob("node_modules/**", "node_modules_backup/x")).toBe(false);
    expect(matchGlob("**/test/setup.*", "test/setup.ts")).toBe(true);
    expect(matchGlob("**/test/setup.*", "src/test/setup.ts")).toBe(true);
    expect(matchGlob("**/setupTests.*", "src/setupTests.ts")).toBe(true);
    expect(matchGlob("a?c", "abc")).toBe(true);
    expect(matchGlob("a?c", "ac")).toBe(false);
    expect(matchGlob("*", "a/b")).toBe(false);
    expect(matchGlob("package.json", "Package.json")).toBe(process.platform === "win32");
  });
});

describe("snapshotTree and diffSnapshots", () => {
  it("hashes files, records directories, and skips only a real .git directory", () => {
    withTemp((root) => {
      mkdirSync(join(root, "sub"));
      mkdirSync(join(root, ".git"));
      mkdirSync(join(root, ".github", "workflows"), { recursive: true });
      writeFileSync(join(root, "sub", "a.txt"), "hello");
      writeFileSync(join(root, ".git", "config"), "git");
      writeFileSync(join(root, ".gitignore"), "node_modules\n");
      writeFileSync(join(root, ".github", "workflows", "verify.yml"), "name: verify\n");
      const snap = snapshotTree(root);
      expect(snap.get("sub")).toEqual({ kind: "dir" });
      expect(snap.get("sub/a.txt")).toEqual({
        kind: "file",
        sha256: createHash("sha256").update("hello").digest("hex"),
      });
      expect(snap.has(".gitignore")).toBe(true);
      expect(snap.get(".github/workflows/verify.yml")?.kind).toBe("file");
      expect([...snap.keys()].some((key) => key === ".git" || key.startsWith(".git/"))).toBe(false);
      expect(() => snapshotTree(root, { skip: [".github"] } as unknown as SnapshotOptions)).toThrow(/Unknown snapshot option/);
    });
  });

  it("lists added, removed, modified, and kind-changed paths in order", () => {
    withTemp((root) => {
      writeFileSync(join(root, "b.txt"), "b");
      writeFileSync(join(root, "c.txt"), "c");
      writeFileSync(join(root, "keep.txt"), "same");
      const before = snapshotTree(root);
      writeFileSync(join(root, "b.txt"), "changed");
      rmSync(join(root, "c.txt"));
      writeFileSync(join(root, "a.txt"), "new");
      writeFileSync(join(root, "kind"), "file");
      const mid = snapshotTree(root);
      rmSync(join(root, "kind"));
      mkdirSync(join(root, "kind"));
      const after = snapshotTree(root);
      expect(diffSnapshots(before, mid)).toEqual(["a.txt", "b.txt", "c.txt", "kind"]);
      expect(diffSnapshots(before, before)).toEqual([]);
      expect(diffSnapshots(mid, after)).toEqual(["kind"]);
      expect(after.get("kind")).toEqual({ kind: "dir" });
      expect(mid.get("kind")?.kind).toBe("file");
    });
  });
});

describe("checkWrites", () => {
  it("reports a directory symlink into tools/verify or outside the root", () => {
    withTemp((parent) => {
      const root = join(parent, "root");
      const outside = join(parent, "outside");
      mkdirSync(join(root, "tools", "verify"), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(root, "tools", "verify", "secret.ts"), "secret");
      writeFileSync(join(outside, "secret.txt"), "out");
      const before = snapshotTree(root);
      linkDir(join(root, "tools", "verify"), join(root, "alias"));
      linkDir(outside, join(root, "escape"));
      const after = snapshotTree(root);
      expect(after.get("alias")).toEqual({ kind: "symlink", linkTarget: readlinkSync(join(root, "alias")) });
      expect(after.get("escape")?.kind).toBe("symlink");
      const changed = diffSnapshots(before, after);
      expect(changed).toEqual(["alias", "escape"]);
      expect(changed.some((path) => path.startsWith("alias/") || path.startsWith("escape/"))).toBe(false);
      const result = checkWrites({ root, changed, declaredWrites: ["**"] });
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual([
        { path: "alias", reason: "symlink" },
        { path: "escape", reason: "symlink" },
      ]);
      expect(checkWrites({ root, changed: ["alias/secret.ts"], declaredWrites: ["alias/**"] }).violations).toEqual([
        { path: "alias/secret.ts", reason: "protected" },
      ]);
      expect(checkWrites({ root, changed: ["escape/secret.txt"], declaredWrites: ["escape/**"] }).violations).toEqual([
        { path: "escape/secret.txt", reason: "outside_root" },
      ]);
    });
  });

  it.skipIf(fileSymlinkEperm)("reports a file symlink into tools/verify or outside the root (skipped when symlink creation throws EPERM)", () => {
    withTemp((parent) => {
      const root = join(parent, "root");
      const outside = join(parent, "outside");
      mkdirSync(join(root, "tools", "verify"), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(root, "tools", "verify", "secret.ts"), "secret");
      writeFileSync(join(outside, "secret.txt"), "out");
      const before = snapshotTree(root);
      symlinkSync(join(root, "tools", "verify", "secret.ts"), join(root, "leak.ts"));
      symlinkSync(join(outside, "secret.txt"), join(root, "escape.ts"));
      const changed = diffSnapshots(before, snapshotTree(root));
      const result = checkWrites({ root, changed, declaredWrites: ["**"] });
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual([
        { path: "escape.ts", reason: "symlink" },
        { path: "leak.ts", reason: "symlink" },
      ]);
    });
  });

  it("reports a relative path whose realpath leaves the root", () => {
    withTemp((parent) => {
      const root = join(parent, "root");
      const outside = join(parent, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      writeFileSync(join(outside, "secret.txt"), "x");
      const escaped = relative(root, join(outside, "secret.txt")).split(sep).join("/");
      const result = checkWrites({ root, changed: [escaped], declaredWrites: ["**"] });
      expect(result).toEqual({ ok: false, violations: [{ path: escaped, reason: "outside_root" }] });
    });
  });

  it("marks package.json, vitest config, .npmrc, and tsconfig protected even when they are declared", () => {
    withTemp((root) => {
      mkdirSync(join(root, "packages", "app"), { recursive: true });
      writeFileSync(join(root, "package.json"), "{}\n");
      writeFileSync(join(root, "vitest.config.ts"), "export default {}\n");
      writeFileSync(join(root, ".npmrc"), "ignore-scripts=true\n");
      writeFileSync(join(root, "tsconfig.json"), "{}\n");
      writeFileSync(join(root, "tsconfig.app.json"), "{}\n");
      writeFileSync(join(root, "packages", "app", "package.json"), "{}\n");
      const before = snapshotTree(root);
      writeFileSync(join(root, "package.json"), "{\"private\":true}\n");
      writeFileSync(join(root, "vitest.config.ts"), "export default { test: {} }\n");
      writeFileSync(join(root, ".npmrc"), "fund=false\n");
      writeFileSync(join(root, "tsconfig.json"), "{\"files\":[]}\n");
      writeFileSync(join(root, "tsconfig.app.json"), "{\"files\":[]}\n");
      writeFileSync(join(root, "packages", "app", "package.json"), "{\"private\":true}\n");
      const changed = diffSnapshots(before, snapshotTree(root));
      const result = checkWrites({
        root,
        changed,
        declaredWrites: ["**", "package.json", "vitest.config.ts", "vitest.config.*", ".npmrc", "tsconfig.json", "packages/app/**"],
      });
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual([
        { path: ".npmrc", reason: "protected" },
        { path: "package.json", reason: "protected" },
        { path: "packages/app/package.json", reason: "protected" },
        { path: "tsconfig.app.json", reason: "protected" },
        { path: "tsconfig.json", reason: "protected" },
        { path: "vitest.config.ts", reason: "protected" },
      ]);
    });
  });

  it("rejects an undeclared write and accepts a declared one", () => {
    withTemp((root) => {
      mkdirSync(join(root, "allowed"));
      const before = snapshotTree(root);
      writeFileSync(join(root, "allowed", "out.txt"), "ok");
      writeFileSync(join(root, "sneak.txt"), "no");
      const changed = diffSnapshots(before, snapshotTree(root));
      expect(changed).toEqual(["allowed/out.txt", "sneak.txt"]);
      const result = checkWrites({ root, changed, declaredWrites: ["allowed/**"] });
      expect(result).toEqual({ ok: false, violations: [{ path: "sneak.txt", reason: "undeclared" }] });
      expect(checkWrites({ root, changed: ["allowed/out.txt"], declaredWrites: ["allowed/**"] })).toEqual({
        ok: true,
        violations: [],
      });
    });
  });

  it("uses a caller protected list in place of the default", () => {
    expect(DEFAULT_PROTECTED).toContain("tools/verify/**");
    expect(DEFAULT_PROTECTED).toContain("**/package.json");
    expect(DEFAULT_PROTECTED).toContain("**/.npmrc");
    withTemp((root) => {
      mkdirSync(join(root, "secret"));
      writeFileSync(join(root, "package.json"), "{}\n");
      writeFileSync(join(root, "secret", "a.txt"), "x");
      const result = checkWrites({
        root,
        changed: ["package.json", "secret/a.txt"],
        declaredWrites: ["**"],
        protectedPatterns: ["secret/**"],
      });
      expect(result).toEqual({ ok: false, violations: [{ path: "secret/a.txt", reason: "protected" }] });
    });
  });
});
