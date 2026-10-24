import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertVerifierIsolation,
  buildVerifierDepsInstall,
  checkVerifierIsolation,
  isInside,
  resolveLoadedVitest,
  toP1VerifierRuntime,
  verifierDepsDir,
  verifierProvenance,
  verifierRootFromModule,
} from "../src/verifier-deps.ts";

function withTemp(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ludion-vd-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeVitest(dir: string, version: string, integrity: string | null, lockVersion = version, bin: string | { vitest: string } = { vitest: "./vitest.mjs" }): void {
  const pkgDir = join(dir, "node_modules", "vitest");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "vitest", version, bin }));
  writeFileSync(join(pkgDir, "vitest.mjs"), "#!/usr/bin/env node\n");
  const locked: { version: string; integrity?: string } = { version: lockVersion };
  if (integrity !== null) locked.integrity = integrity;
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: { "node_modules/vitest": locked },
  }));
}

describe("path containment", () => {
  it("counts a directory as inside itself, a child as inside, and a prefix sibling as outside", () => {
    withTemp((parent) => {
      const dir = join(parent, "repo");
      const child = join(dir, "child");
      const sibling = join(parent, "repo-other");
      const missing = join(dir, "not-yet", "file.ts");
      mkdirSync(child, { recursive: true });
      mkdirSync(sibling);
      expect(isInside(dir, dir)).toBe(true);
      expect(isInside(child, dir)).toBe(true);
      expect(isInside(dir, child)).toBe(false);
      expect(isInside(sibling, dir)).toBe(false);
      expect(isInside(dir, sibling)).toBe(false);
      expect(isInside(missing, dir)).toBe(true);
      expect(isInside(join(sibling, "missing"), dir)).toBe(false);
      if (process.platform === "win32") expect(isInside(child.toUpperCase(), dir.toLowerCase())).toBe(true);
    });
  });

  it("follows a junction out of the parent", () => {
    withTemp((parent) => {
      const box = join(parent, "box");
      const outside = join(parent, "outside");
      const link = join(box, "escape");
      mkdirSync(box);
      mkdirSync(outside);
      writeFileSync(join(outside, "f"), "x");
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      expect(isInside(link, box)).toBe(false);
      expect(isInside(join(link, "f"), box)).toBe(false);
      expect(isInside(join(link, "f"), outside)).toBe(true);
    });
  });
});

describe("verifier deps directory", () => {
  it("names the directory from the first 16 hex characters and rejects anything else", () => {
    withTemp((parent) => {
      const hex = "ab".repeat(32);
      expect(verifierDepsDir(hex, parent)).toBe(join(parent, `ludion-verifier-deps-${hex.slice(0, 16)}`));
      expect(() => verifierDepsDir(hex.toUpperCase(), parent)).toThrow(/64 lowercase hex/);
      expect(() => verifierDepsDir(`sha256:${hex}`, parent)).toThrow(/64 lowercase hex/);
      expect(() => verifierDepsDir(hex.slice(0, 63), parent)).toThrow(/64 lowercase hex/);
      expect(() => verifierDepsDir(`${hex}0`, parent)).toThrow(/64 lowercase hex/);
    });
  });

  it("builds an npm ci command with scripts, audit, and fund off", () => {
    const deps = join(tmpdir(), "ludion-verifier-deps-example");
    expect(buildVerifierDepsInstall(deps)).toEqual({
      command: "npm",
      args: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      cwd: deps,
    });
  });

  it("is false for the current CI layout and true for a sibling directory", () => {
    withTemp((parent) => {
      const recipient = join(parent, "pr");
      const ciDeps = join(recipient, ".verifier");
      const sibling = join(parent, "deps");
      mkdirSync(ciDeps, { recursive: true });
      mkdirSync(sibling);
      const ci = checkVerifierIsolation({ depsDir: ciDeps, recipientRoot: recipient });
      expect(ci.isolated).toBe(false);
      expect(ci.reason).toMatch(/inside the recipient/);
      expect(checkVerifierIsolation({ depsDir: recipient, recipientRoot: recipient }).isolated).toBe(false);
      expect(checkVerifierIsolation({ depsDir: sibling, recipientRoot: recipient })).toEqual({ isolated: true });
      expect(() => assertVerifierIsolation({ depsDir: ciDeps, recipientRoot: recipient })).toThrow(/not isolated/);
      expect(() => assertVerifierIsolation({ depsDir: sibling, recipientRoot: recipient })).not.toThrow();
    });
  });
});

describe("resolveLoadedVitest", () => {
  it("returns the deps install's 4.1.11, not the recipient tree's 9.9.9", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      const recipient = join(parent, "recipient");
      writeVitest(deps, "4.1.11", "sha512-test");
      writeVitest(recipient, "9.9.9", "sha512-recipient");
      const loaded = resolveLoadedVitest(deps);
      const lockBytes = readFileSync(join(deps, "package-lock.json"));
      expect(loaded.vitest_version).toBe("4.1.11");
      expect(loaded.integrity).toBe("sha512-test");
      expect(loaded.vitest_relpath).toBe("node_modules/vitest/vitest.mjs");
      expect(loaded.lockfile_sha256).toBe(`sha256:${createHash("sha256").update(lockBytes).digest("hex")}`);
      expect(isInside(loaded.install_root, deps)).toBe(true);
      expect(isInside(deps, loaded.install_root)).toBe(true);
      expect(isInside(loaded.vitest_realpath, deps)).toBe(true);
      expect(isInside(loaded.vitest_realpath, recipient)).toBe(false);
      expect(loaded.vitest_realpath).not.toContain("9.9.9");
      expect(toP1VerifierRuntime(loaded)).toEqual({ vitest_version: "4.1.11", vitest_path: loaded.vitest_realpath });
      expect(() => toP1VerifierRuntime({ ...loaded, vitest_realpath: "x".repeat(261) })).toThrow(/260/);
      expect(toP1VerifierRuntime({ ...loaded, vitest_realpath: "x".repeat(260) }).vitest_path).toHaveLength(260);

      const report = verifierProvenance({ verifierRoot: deps, recipientRoot: recipient, nodeVersion: "v24.0.0" });
      expect(report).toEqual({
        node_version: "v24.0.0",
        isolation: { isolated: true },
        loaded_vitest: loaded,
      });
    });
  });

  it("accepts a string bin entry", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      writeVitest(deps, "4.1.11", null, "4.1.11", "./vitest.mjs");
      const loaded = resolveLoadedVitest(deps);
      expect(loaded.vitest_version).toBe("4.1.11");
      expect(loaded.integrity).toBeNull();
      expect(loaded.vitest_relpath).toBe("node_modules/vitest/vitest.mjs");
    });
  });

  it("rejects a junction from the deps vitest directory to the recipient vitest", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      const recipient = join(parent, "recipient");
      writeVitest(recipient, "9.9.9", "sha512-recipient");
      mkdirSync(join(deps, "node_modules"), { recursive: true });
      writeFileSync(join(deps, "package-lock.json"), JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/vitest": { version: "9.9.9", integrity: "sha512-recipient" } },
      }));
      symlinkSync(join(recipient, "node_modules", "vitest"), join(deps, "node_modules", "vitest"), process.platform === "win32" ? "junction" : "dir");
      expect(() => resolveLoadedVitest(deps)).toThrow(/resolves outside the verifier deps directory/);
    });
  });

  it("rejects a bin entry that resolves outside the deps directory", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      const recipient = join(parent, "recipient");
      mkdirSync(recipient, { recursive: true });
      writeFileSync(join(recipient, "vitest.mjs"), "#!/usr/bin/env node\n");
      writeVitest(deps, "4.1.11", "sha512-test", "4.1.11", { vitest: "../../../recipient/vitest.mjs" });
      expect(() => resolveLoadedVitest(deps)).toThrow(/vitest bin resolves outside/);
    });
  });

  it("throws when the lockfile version does not match the installed tree", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      writeVitest(deps, "4.1.11", "sha512-test", "9.9.9");
      expect(() => resolveLoadedVitest(deps)).toThrow(/does not match the lockfile/);
    });
  });

  it("throws when the loaded version is a prerelease", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      writeVitest(deps, "4.1.11-beta.1", "sha512-test");
      expect(() => resolveLoadedVitest(deps)).toThrow(/not a stable x\.y\.z version/);
    });
  });

  it("reports a read failure without throwing, and reports the CI layout as not isolated", () => {
    withTemp((parent) => {
      const recipient = join(parent, "pr");
      const ciDeps = join(recipient, ".verifier");
      const empty = join(parent, "empty");
      writeVitest(ciDeps, "4.1.11", "sha512-test");
      mkdirSync(empty);
      const ci = verifierProvenance({ verifierRoot: ciDeps, recipientRoot: recipient, nodeVersion: "v22.11.0" });
      expect(ci.node_version).toBe("v22.11.0");
      expect(ci.isolation.isolated).toBe(false);
      expect(ci.loaded_vitest?.vitest_version).toBe("4.1.11");
      const missing = verifierProvenance({ verifierRoot: empty, recipientRoot: recipient, nodeVersion: "v22.11.0" });
      expect(missing.loaded_vitest).toBeNull();
      expect(missing.loaded_vitest_error).toMatch(/vitest/);
      expect(missing.isolation).toEqual({ isolated: true });
    });
  });

  it("reads the vitest that is actually installed at the verifier root", () => {
    const root = verifierRootFromModule(new URL("../src/verifier-deps.ts", import.meta.url));
    const pkgPath = join(root, "node_modules", "vitest", "package.json");
    const lockPath = join(root, "package-lock.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages: { "node_modules/vitest": { integrity: string; version: string } } };
    const loaded = resolveLoadedVitest(root);
    expect(loaded.vitest_version).toBe(pkg.version);
    expect(loaded.vitest_version).toBe(lock.packages["node_modules/vitest"].version);
    expect(loaded.integrity).toBe(lock.packages["node_modules/vitest"].integrity);
    expect(loaded.vitest_relpath).toBe("node_modules/vitest/vitest.mjs");
    expect(isInside(loaded.vitest_realpath, root)).toBe(true);
    expect(verifierRootFromModule(new URL("../../../tools/verify/src/pr-cli.ts", import.meta.url))).toBe(root);
    expect(dirname(fileURLToPath(new URL("../src/verifier-deps.ts", import.meta.url)))).toBe(join(root, "tools", "verify", "src"));
  });
});

describe("pr-cli wiring", () => {
  it("attaches verifier provenance without replacing results or labels", () => {
    const text = readFileSync(fileURLToPath(new URL("../src/pr-cli.ts", import.meta.url)), "utf8");
    expect(text).toContain("const labels = labelsOf(results);");
    expect(text).toContain("verifierRoot: verifierRootFromModule(import.meta.url)");
    expect(text).toContain("recipientRoot: process.cwd()");
    expect(text).toContain("nodeVersion: process.version");
    expect(text).toContain("{ results, labels, verifier }");
    expect(text).toContain("verifierProvenance({");
  });
});
