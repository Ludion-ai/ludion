import { createHash } from "node:crypto";
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { checkWrites, DEFAULT_PROTECTED, diffSnapshots, matchGlob, snapshotTree, type SnapshotEntry, type SnapshotOptions } from "../src/write-check.ts";

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

function hardlinkRefused(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "ludion-link-"));
  try {
    writeFileSync(join(dir, "a"), "x");
    try {
      linkSync(join(dir, "a"), join(dir, "b"));
      return false;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code === "EPERM" || code === "ENOTSUP" || code === "EACCES";
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const hardlinkUnavailable = hardlinkRefused();

function fileSnap(root: string, rel: string, text: string): SnapshotEntry {
  const st = lstatSync(join(root, rel));
  return { kind: "file", sha256: createHash("sha256").update(text).digest("hex"), mode: st.mode & 0o7777, nlink: st.nlink };
}

function dirSnap(root: string, rel: string): SnapshotEntry {
  return { kind: "dir", mode: lstatSync(join(root, rel)).mode & 0o7777 };
}

function linkSnap(root: string, rel: string): SnapshotEntry {
  const abs = join(root, rel);
  return { kind: "symlink", linkTarget: readlinkSync(abs), mode: lstatSync(abs).mode & 0o7777 };
}

describe("matchGlob", () => {
  it("matches *, **, and ? without crossing a slash, and ignores case", () => {
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
    expect(matchGlob("package.json", "Package.json")).toBe(true);
    expect(matchGlob("**/vitest.workspace.*", "src/vitest.workspace.ts")).toBe(true);
    expect(matchGlob("**/vitest.projects.*", "src/vitest.projects.ts")).toBe(true);
    expect(matchGlob("**/vite.config.*", "src/Vite.config.ts")).toBe(true);
    expect(matchGlob("**/.yarnrc", ".yarnrc")).toBe(true);
    expect(matchGlob("**/.yarnrc.yml", ".yarnrc.yml")).toBe(true);
    expect(matchGlob("**/.yarnrc.yaml", ".yarnrc.yaml")).toBe(true);
    expect(matchGlob("**/.yarnrc", ".yarnrc.test.ts")).toBe(false);
    expect(matchGlob("**/.yarnrc.yml", ".yarnrc.test.ts")).toBe(false);
    expect(matchGlob("**/.yarnrc.yaml", ".yarnrc.test.ts")).toBe(false);
    expect(matchGlob("**/bunfig.toml", "bunfig.toml")).toBe(true);
    expect(matchGlob(".git/**", ".git")).toBe(true);
    expect(matchGlob(".git/**", ".git/hooks/post-checkout")).toBe(true);
    expect(matchGlob("**/.git/**", "src/.git/config")).toBe(true);
  });
});

describe("snapshotTree and diffSnapshots", () => {
  it("hashes files, records directories and mode, and includes .git", () => {
    withTemp((root) => {
      mkdirSync(join(root, "sub"));
      mkdirSync(join(root, ".git"));
      mkdirSync(join(root, ".github", "workflows"), { recursive: true });
      writeFileSync(join(root, "sub", "a.txt"), "hello");
      writeFileSync(join(root, ".git", "config"), "git");
      writeFileSync(join(root, ".gitignore"), "node_modules\n");
      writeFileSync(join(root, ".github", "workflows", "verify.yml"), "name: verify\n");
      const snap = snapshotTree(root);
      expect(snap.get("sub")).toEqual(dirSnap(root, "sub"));
      expect(snap.get("sub/a.txt")).toEqual(fileSnap(root, "sub/a.txt", "hello"));
      expect(snap.has(".gitignore")).toBe(true);
      expect(snap.get(".github/workflows/verify.yml")?.kind).toBe("file");
      expect(snap.get(".git")).toEqual(dirSnap(root, ".git"));
      expect(snap.get(".git/config")).toEqual(fileSnap(root, ".git/config", "git"));
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
      expect(after.get("kind")).toEqual(dirSnap(root, "kind"));
      expect(mid.get("kind")?.kind).toBe("file");
    });
  });

  it("treats a mode change as a change, including a synthetic snapshot", () => {
    withTemp((root) => {
      const file = join(root, "a.txt");
      writeFileSync(file, "x");
      const before = snapshotTree(root);
      const beforeMode = before.get("a.txt")?.mode;
      chmodSync(file, 0o755);
      const after = snapshotTree(root);
      if (after.get("a.txt")?.mode !== beforeMode) {
        expect(diffSnapshots(before, after)).toEqual(["a.txt"]);
        expect(checkWrites({ root, changed: ["a.txt"], declaredWrites: ["other/**"] }).violations).toEqual([
          { path: "a.txt", reason: "undeclared" },
        ]);
      } else {
        expect(diffSnapshots(before, after)).toEqual([]);
      }
    });
    const left = new Map<string, SnapshotEntry>([["a.txt", { kind: "file", sha256: "ab", mode: 0o644, nlink: 1 }]]);
    const right = new Map<string, SnapshotEntry>([["a.txt", { kind: "file", sha256: "ab", mode: 0o755, nlink: 1 }]]);
    expect(diffSnapshots(left, right)).toEqual(["a.txt"]);
    expect(diffSnapshots(left, left)).toEqual([]);
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
      expect(after.get("alias")).toEqual(linkSnap(root, "alias"));
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
    expect(DEFAULT_PROTECTED).toContain(".git/**");
    expect(DEFAULT_PROTECTED).toContain("**/.git/**");
    expect(DEFAULT_PROTECTED).toContain("**/vitest.workspace.*");
    expect(DEFAULT_PROTECTED).toContain("**/vitest.projects.*");
    expect(DEFAULT_PROTECTED).toContain("**/vite.config.*");
    expect(DEFAULT_PROTECTED).toContain("**/.git");
    expect(DEFAULT_PROTECTED).toContain("**/.gitmodules");
    expect(DEFAULT_PROTECTED).toContain("**/.husky/**");
    expect(DEFAULT_PROTECTED).toContain("**/.yarnrc");
    expect(DEFAULT_PROTECTED).toContain("**/.yarnrc.yml");
    expect(DEFAULT_PROTECTED).toContain("**/.yarnrc.yaml");
    expect(DEFAULT_PROTECTED).toContain("**/.pnpmfile.cjs");
    expect(DEFAULT_PROTECTED).not.toContain("**/.yarnrc*");
    expect(DEFAULT_PROTECTED).toContain("**/bunfig.toml");
    expect(DEFAULT_PROTECTED).toContain("**/package-lock.json");
    expect(DEFAULT_PROTECTED).toContain("**/npm-shrinkwrap.json");
    expect(DEFAULT_PROTECTED).toContain("**/pnpm-lock.yaml");
    expect(DEFAULT_PROTECTED).toContain("**/yarn.lock");
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

  it("protects .git, nested config, and a case-different path", () => {
    withTemp((root) => {
      mkdirSync(join(root, ".git", "hooks"), { recursive: true });
      mkdirSync(join(root, "src"), { recursive: true });
      writeFileSync(join(root, ".git", "config"), "[core]\n");
      writeFileSync(join(root, "src", "vitest.workspace.ts"), "export default {}\n");
      writeFileSync(join(root, "src", "vitest.projects.ts"), "export default {}\n");
      writeFileSync(join(root, "src", "vite.config.ts"), "export default {}\n");
      writeFileSync(join(root, ".yarnrc.yml"), "x\n");
      writeFileSync(join(root, "bunfig.toml"), "x\n");
      const before = snapshotTree(root);
      writeFileSync(join(root, ".git", "config"), "[core]\n\tbare = false\n");
      writeFileSync(join(root, ".git", "hooks", "post-checkout"), "#!/bin/sh\n");
      writeFileSync(join(root, "src", "vitest.workspace.ts"), "export default { test: {} }\n");
      writeFileSync(join(root, "src", "vitest.projects.ts"), "export default []\n");
      writeFileSync(join(root, "src", "vite.config.ts"), "export default { plugins: [] }\n");
      writeFileSync(join(root, ".yarnrc.yml"), "y\n");
      writeFileSync(join(root, "bunfig.toml"), "y\n");
      const changed = diffSnapshots(before, snapshotTree(root));
      expect(checkWrites({ root, changed, declaredWrites: ["**"] }).violations).toEqual([
        { path: ".git/config", reason: "protected" },
        { path: ".git/hooks/post-checkout", reason: "protected" },
        { path: ".yarnrc.yml", reason: "protected" },
        { path: "bunfig.toml", reason: "protected" },
        { path: "src/vite.config.ts", reason: "protected" },
        { path: "src/vitest.projects.ts", reason: "protected" },
        { path: "src/vitest.workspace.ts", reason: "protected" },
      ]);
      expect(checkWrites({
        root,
        changed: ["Package.json", "SRC/Vite.config.js", "VITEST.CONFIG.TS", "Sub/Vitest.Workspace.ts", ".yarnrc.test.ts", ".yarnrc.yml"],
        declaredWrites: ["**"],
      }).violations).toEqual([
        { path: ".yarnrc.yml", reason: "protected" },
        { path: "Package.json", reason: "protected" },
        { path: "SRC/Vite.config.js", reason: "protected" },
        { path: "Sub/Vitest.Workspace.ts", reason: "protected" },
        { path: "VITEST.CONFIG.TS", reason: "protected" },
      ]);
    });
  });

  it("does not treat a new directory as a hard link", () => {
    withTemp((root) => {
      const before = snapshotTree(root);
      mkdirSync(join(root, "added"));
      const changed = diffSnapshots(before, snapshotTree(root));
      expect(checkWrites({ root, changed, declaredWrites: ["**"] })).toEqual({ ok: true, violations: [] });
    });
  });

  it.skipIf(hardlinkUnavailable)("rejects a changed or added regular file with nlink > 1 (skipped when linkSync is refused)", () => {
    withTemp((root) => {
      writeFileSync(join(root, "a.txt"), "same");
      const before = snapshotTree(root);
      linkSync(join(root, "a.txt"), join(root, "b.txt"));
      const changed = diffSnapshots(before, snapshotTree(root));
      expect(changed).toEqual(["a.txt", "b.txt"]);
      expect(checkWrites({ root, changed, declaredWrites: ["**"] }).violations).toEqual([
        { path: "a.txt", reason: "hardlink" },
        { path: "b.txt", reason: "hardlink" },
      ]);
    });
  });
});
