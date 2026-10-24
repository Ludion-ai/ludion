import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertVerifierIsolation,
  buildVerifierDepsInstall,
  checkVerifierIsolation,
  isInside,
  lockfileSha256AtHead,
  resolveLoadedVitest,
  validateVerifierRuntime,
  VERIFIER_STORE_PREFIX,
  verifierDepsDir,
  verifierProvenance,
  verifierRootFromModule,
  type VerifierRuntime,
} from "../src/verifier-deps.ts";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const HEX = "ab".repeat(32);

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

function lockHash(dir: string): string {
  return createHash("sha256").update(readFileSync(join(dir, "package-lock.json"))).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** String keys and values in a serialized receipt. A non-JSON blob is one string. */
function receiptStrings(json: string): string[] {
  try {
    const found: string[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "string") {
        found.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          found.push(key);
          visit(item);
        }
      }
    };
    visit(JSON.parse(json));
    return found;
  } catch {
    return [json];
  }
}

function hostUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

/**
 * Username is a path segment, not a substring. `node` must not match `node_version`
 * or `node_modules`. `username` defaults to the host user; tests pass a fixed name.
 */
function assertNoHostPaths(json: string, extras: string[] = [], username = hostUsername()): void {
  expect(json).not.toMatch(/[A-Za-z]:[\\/]/);
  expect(json).not.toContain("\\");
  expect(json).not.toContain("/home/");
  expect(json).not.toContain("/Users/");
  const names = [tmpdir(), homedir(), process.cwd(), process.env.RUNNER_TEMP, ...extras];
  for (const value of names) {
    if (typeof value !== "string" || value.length === 0) continue;
    expect(json).not.toContain(value);
    expect(json).not.toContain(value.replaceAll("\\", "/"));
  }
  if (username.length === 0) return;
  const segment = new RegExp(`(^|[\\\\/])${escapeRegExp(username)}([\\\\/]|$)`, process.platform === "win32" ? "i" : "");
  const needles = [`/home/${username}`, `\\Users\\${username}`, `/Users/${username}`];
  for (const value of receiptStrings(json)) {
    expect(value, value).not.toMatch(segment);
    for (const needle of needles) expect(value, value).not.toContain(needle);
  }
}

describe("assertNoHostPaths", () => {
  it("flags the username only as a path segment", () => {
    const receipt = (value: string) => JSON.stringify(value);
    expect(() => assertNoHostPaths(receipt("node_version"), [], "node")).not.toThrow();
    expect(() => assertNoHostPaths(receipt("/verifier/node_modules/vitest/vitest.mjs"), [], "node")).not.toThrow();
    expect(() => assertNoHostPaths(receipt("/home/node/x"), [], "node")).toThrow();
    expect(() => assertNoHostPaths(receipt("C:\\Users\\node\\x"), [], "node")).toThrow();
    expect(() => assertNoHostPaths(receipt("/var/node/x"), [], "node")).toThrow();
  });
});

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
  it("returns the in-container path for the deps install, not the recipient tree", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      const recipient = join(parent, "recipient");
      writeVitest(deps, "4.1.11", INTEGRITY);
      writeVitest(recipient, "9.9.9", INTEGRITY);
      const hash = lockHash(deps);
      const loaded = resolveLoadedVitest(deps, hash);
      expect(loaded).toEqual({
        vitest_location: "verifier_store",
        vitest_realpath: `${VERIFIER_STORE_PREFIX}node_modules/vitest/vitest.mjs`,
        vitest_version: "4.1.11",
        vitest_integrity: INTEGRITY,
        lockfile_sha256: hash,
      });
      expect(loaded).not.toHaveProperty("install_root");
      expect(Object.keys(loaded).sort()).toEqual([
        "lockfile_sha256",
        "vitest_integrity",
        "vitest_location",
        "vitest_realpath",
        "vitest_version",
      ]);
      expect(loaded.vitest_location).toBe("verifier_store");
      expect(loaded.vitest_version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
      expect(loaded.vitest_version.length).toBeLessThanOrEqual(128);
      expect(loaded.vitest_integrity).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
      expect(loaded.lockfile_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(validateVerifierRuntime(loaded)).toBeNull();
      expect(JSON.stringify(loaded)).not.toContain("9.9.9");
      expect(() => resolveLoadedVitest(deps, HEX)).toThrow(/^lockfile_sha256_mismatch$/);
      expect(() => resolveLoadedVitest(deps, `sha256:${hash}`)).toThrow(/^lockfile_sha256_mismatch$/);

      const previous = process.env.RUNNER_TEMP;
      process.env.RUNNER_TEMP = deps;
      try {
        const report = verifierProvenance({
          verifierRoot: deps,
          recipientRoot: recipient,
          nodeVersion: "v24.0.0",
          expectedLockfileSha256: hash,
        });
        expect(report).toEqual({
          node_version: "v24.0.0",
          isolation: { isolated: true },
          trusted: true,
          verifier_runtime: loaded,
        });
        assertNoHostPaths(JSON.stringify(report), [deps, recipient, parent]);
      } finally {
        if (previous === undefined) delete process.env.RUNNER_TEMP;
        else process.env.RUNNER_TEMP = previous;
      }
    });
  });

  it("rejects a missing integrity and accepts a prerelease that matches the schema", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      writeVitest(deps, "4.1.11", null, "4.1.11", "./vitest.mjs");
      expect(() => resolveLoadedVitest(deps, lockHash(deps))).toThrow(/^vitest_integrity_missing$/);
      writeVitest(deps, "4.1.11-beta.1", INTEGRITY);
      const loaded = resolveLoadedVitest(deps, lockHash(deps));
      expect(loaded.vitest_version).toBe("4.1.11-beta.1");
      expect(loaded.vitest_realpath).toBe("/verifier/node_modules/vitest/vitest.mjs");
      expect(validateVerifierRuntime(loaded)).toBeNull();
      writeVitest(deps, "4.1", INTEGRITY);
      expect(() => resolveLoadedVitest(deps, lockHash(deps))).toThrow(/not SemVer 2\.0/);
      writeVitest(deps, "01.2.3", INTEGRITY);
      expect(() => resolveLoadedVitest(deps, lockHash(deps))).toThrow(/not SemVer 2\.0/);
    });
  });

  it("rejects a junction from the deps vitest directory to the recipient vitest", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      const recipient = join(parent, "recipient");
      writeVitest(recipient, "9.9.9", INTEGRITY);
      mkdirSync(join(deps, "node_modules"), { recursive: true });
      writeFileSync(join(deps, "package-lock.json"), JSON.stringify({
        lockfileVersion: 3,
        packages: { "node_modules/vitest": { version: "9.9.9", integrity: INTEGRITY } },
      }));
      symlinkSync(join(recipient, "node_modules", "vitest"), join(deps, "node_modules", "vitest"), process.platform === "win32" ? "junction" : "dir");
      expect(() => resolveLoadedVitest(deps, HEX)).toThrow(/resolves outside the verifier deps directory/);
    });
  });

  it("rejects a bin entry that resolves outside the deps directory", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      const recipient = join(parent, "recipient");
      mkdirSync(recipient, { recursive: true });
      writeFileSync(join(recipient, "vitest.mjs"), "#!/usr/bin/env node\n");
      writeVitest(deps, "4.1.11", INTEGRITY, "4.1.11", { vitest: "../../../recipient/vitest.mjs" });
      expect(() => resolveLoadedVitest(deps, HEX)).toThrow(/vitest bin resolves outside/);
    });
  });

  it("throws when the lockfile version does not match the installed tree", () => {
    withTemp((parent) => {
      const deps = join(parent, "deps");
      writeVitest(deps, "4.1.11", INTEGRITY, "9.9.9");
      expect(() => resolveLoadedVitest(deps, lockHash(deps))).toThrow(/does not match the lockfile/);
    });
  });

  it("does not trust a vitest that is not isolated, and hides filesystem errors", () => {
    withTemp((parent) => {
      const recipient = join(parent, "pr");
      const ciDeps = join(recipient, ".verifier");
      const empty = join(parent, "empty");
      writeVitest(ciDeps, "4.1.11", INTEGRITY);
      mkdirSync(empty);
      const ci = verifierProvenance({
        verifierRoot: ciDeps,
        recipientRoot: recipient,
        nodeVersion: "v22.11.0",
        expectedLockfileSha256: lockHash(ciDeps),
        lockfileError: "lockfile_git_blob_unreadable",
      });
      expect(ci).toEqual({
        node_version: "v22.11.0",
        isolation: { isolated: false, reason: "Verifier deps directory is inside the recipient tree." },
        trusted: false,
        verifier_runtime: null,
        unavailable_reason: "not_isolated",
      });
      assertNoHostPaths(JSON.stringify(ci), [ciDeps, recipient, parent]);
      const missing = verifierProvenance({
        verifierRoot: empty,
        recipientRoot: recipient,
        nodeVersion: "v22.11.0",
        expectedLockfileSha256: HEX,
      });
      expect(missing.trusted).toBe(false);
      expect(missing.verifier_runtime).toBeNull();
      expect(missing.unavailable_reason).toBe("vitest_unreadable");
      expect(missing.isolation).toEqual({ isolated: true });
      assertNoHostPaths(JSON.stringify(missing), [empty, recipient, parent]);
      const noHash = verifierProvenance({ verifierRoot: empty, recipientRoot: recipient, nodeVersion: "v22.11.0" });
      expect(noHash.unavailable_reason).toBe("lockfile_sha256_missing");
      const gitFail = verifierProvenance({
        verifierRoot: empty,
        recipientRoot: recipient,
        nodeVersion: "v22.11.0",
        lockfileError: "lockfile_git_blob_unreadable",
      });
      expect(gitFail.unavailable_reason).toBe("lockfile_git_blob_unreadable");
    });
  });

  it("reads the vitest installed in this repo and a temp store, with no host path in the JSON", () => {
    const root = verifierRootFromModule(new URL("../src/verifier-deps.ts", import.meta.url));
    const pkgPath = join(root, "node_modules", "vitest", "package.json");
    const lockPath = join(root, "package-lock.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { packages: { "node_modules/vitest": { integrity: string; version: string } } };
    const hash = lockHash(root);
    const loaded = resolveLoadedVitest(root, hash);
    expect(loaded.vitest_version).toBe(pkg.version);
    expect(loaded.vitest_version).toBe("4.1.11");
    expect(loaded.vitest_version).toBe(lock.packages["node_modules/vitest"].version);
    expect(loaded.vitest_integrity).toBe(lock.packages["node_modules/vitest"].integrity);
    expect(loaded.vitest_realpath).toBe("/verifier/node_modules/vitest/vitest.mjs");
    expect(loaded.lockfile_sha256).toBe(hash);
    expect(validateVerifierRuntime(loaded)).toBeNull();
    expect(verifierRootFromModule(new URL("../../../tools/verify/src/pr-cli.ts", import.meta.url))).toBe(root);
    expect(dirname(fileURLToPath(new URL("../src/verifier-deps.ts", import.meta.url)))).toBe(join(root, "tools", "verify", "src"));

    const recipient = mkdtempSync(join(tmpdir(), "ludion-recip-"));
    const previous = process.env.RUNNER_TEMP;
    process.env.RUNNER_TEMP = root;
    try {
      const report = verifierProvenance({
        verifierRoot: root,
        recipientRoot: recipient,
        nodeVersion: process.version,
        expectedLockfileSha256: hash,
      });
      expect(report.trusted).toBe(true);
      expect(validateVerifierRuntime(report.verifier_runtime)).toBeNull();
      assertNoHostPaths(JSON.stringify(report), [root, recipient]);
      const same = verifierProvenance({ verifierRoot: root, recipientRoot: root, nodeVersion: process.version, expectedLockfileSha256: hash });
      expect(same.trusted).toBe(false);
      expect(same.verifier_runtime).toBeNull();
      expect(same.unavailable_reason).toBe("not_isolated");
      assertNoHostPaths(JSON.stringify(same), [root]);
    } finally {
      if (previous === undefined) delete process.env.RUNNER_TEMP;
      else process.env.RUNNER_TEMP = previous;
      rmSync(recipient, { recursive: true, force: true });
    }
  });

  it("detects a dirty working tree against the git blob at HEAD", () => {
    withTemp((dir) => {
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore", windowsHide: true });
      writeFileSync(join(dir, "package-lock.json"), "{}\n");
      const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.email=verify@example.com", "-c", "user.name=verify", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore", windowsHide: true });
      git("add", "package-lock.json");
      git("commit", "-m", "lock");
      const head = lockfileSha256AtHead(dir);
      expect(head).toMatch(/^[0-9a-f]{64}$/);
      writeFileSync(join(dir, "package-lock.json"), "{}\n\n");
      expect(lockfileSha256AtHead(dir)).toBe(head);
      expect(lockHash(dir)).not.toBe(head);
    });
  });
});

describe("validateVerifierRuntime", () => {
  const good = (): VerifierRuntime => ({
    vitest_location: "verifier_store",
    vitest_realpath: "/verifier/node_modules/vitest/vitest.mjs",
    vitest_version: "4.1.11",
    vitest_integrity: INTEGRITY,
    lockfile_sha256: HEX,
  });

  it("accepts the published shape and rejects extras, paths, and bad fields", () => {
    expect(validateVerifierRuntime(good())).toBeNull();
    expect(validateVerifierRuntime({ ...good(), vitest_version: "4.1.11-beta.1+build.5" })).toBeNull();
    expect(validateVerifierRuntime({ ...good(), extra: true })).toBe("verifier_runtime keys");
    const missing = { ...good() } as Partial<VerifierRuntime>;
    delete missing.lockfile_sha256;
    expect(validateVerifierRuntime(missing)).toBe("verifier_runtime keys");
    expect(validateVerifierRuntime({ ...good(), vitest_location: "host" })).toBe("vitest_location");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/tmp/vitest.mjs" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/./x" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/../x" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/a/../b" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/a//b" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/a/" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/node_modules/vitest/vitest.mjs" })).toBeNull();
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/a\\b" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/%2e%2e/x" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier//x" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: `/verifier/${"a".repeat(390)}` })).toBeNull();
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: `/verifier/${"a".repeat(391)}` })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: `/verifier/${"a".repeat(400)}` })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/a\u0001b" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_realpath: "/verifier/a\u007fb" })).toBe("vitest_realpath");
    expect(validateVerifierRuntime({ ...good(), vitest_version: "4.1" })).toBe("vitest_version");
    expect(validateVerifierRuntime({ ...good(), vitest_version: `1.2.3-${"a".repeat(122)}` })).toBeNull();
    expect(validateVerifierRuntime({ ...good(), vitest_version: `1.2.3-${"a".repeat(123)}` })).toBe("vitest_version");
    expect(validateVerifierRuntime({ ...good(), vitest_version: "01.2.3" })).toBe("vitest_version");
    expect(validateVerifierRuntime({ ...good(), vitest_integrity: "sha512-short" })).toBe("vitest_integrity");
    expect(validateVerifierRuntime({ ...good(), lockfile_sha256: `sha256:${HEX}` })).toBe("lockfile_sha256");
    expect(validateVerifierRuntime({ ...good(), lockfile_sha256: HEX.toUpperCase() })).toBe("lockfile_sha256");
    expect(validateVerifierRuntime(null)).toBe("verifier_runtime is not an object");
    expect(validateVerifierRuntime([good()])).toBe("verifier_runtime is not an object");
  });
});

describe("pr-cli wiring", () => {
  it("attaches verifier provenance without replacing results or labels", () => {
    const text = readFileSync(fileURLToPath(new URL("../src/pr-cli.ts", import.meta.url)), "utf8");
    const deps = readFileSync(fileURLToPath(new URL("../src/verifier-deps.ts", import.meta.url)), "utf8");
    expect(text).toContain("const labels = labelsOf(results);");
    expect(text).toContain("verifierRootFromModule(import.meta.url)");
    expect(text).toContain("recipientRoot: process.cwd()");
    expect(text).toContain("nodeVersion: process.version");
    expect(text).toContain("expectedLockfileSha256");
    expect(text).toContain("lockfileSha256AtHead(verifierRoot)");
    expect(text).toContain("lockfile_git_blob_unreadable");
    expect(text).toContain("{ results, labels, verifier }");
    expect(text).toContain("verifierProvenance({");
    expect(text).not.toContain("toP1VerifierRuntime");
    expect(text).not.toContain("loaded_vitest");
    expect(deps).toContain('["-C", verifierRoot, "show", "HEAD:package-lock.json"]');
    expect(deps).toContain("shell: false");
    expect(deps).not.toContain("toP1VerifierRuntime");
  });
});

/**
 * Published P1 capability schema at a pinned commit. The text is data: it is read with git
 * and parsed here. It is not imported, and zod is not imported.
 */
const PUBLISHED_SCHEMA_REV = "078f89d6254d1428e95c973bffacf7b474f47ac8";

function gitText(value: string | Uint8Array): string {
  return typeof value === "string" ? value : Buffer.from(value).toString("utf8");
}

function readPublishedSchema(repoRoot: string): string {
  try {
    execFileSync("git", ["cat-file", "-e", `${PUBLISHED_SCHEMA_REV}^{commit}`], {
      cwd: repoRoot,
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    throw new Error(`Commit ${PUBLISHED_SCHEMA_REV} is not in this clone. Fetch origin/v3/capability-schema.`);
  }
  const shown = execFileSync("git", ["show", `${PUBLISHED_SCHEMA_REV}:packages/capability/src/schema.ts`], {
    cwd: repoRoot,
    shell: false,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = gitText(shown);
  if (text.length === 0) throw new Error(`git show ${PUBLISHED_SCHEMA_REV}:packages/capability/src/schema.ts was empty`);
  return text;
}

function readStringLiteral(source: string, start: number): { value: string; end: number } {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== "`") throw new Error("expected a string literal in the published schema");
  let value = "";
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === undefined) break;
    if (c === "\\") {
      const n = source[i + 1];
      if (n === undefined) throw new Error("unterminated string escape in the published schema");
      if (n === "u" || n === "x") throw new Error("unsupported string escape in the published schema");
      const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"' };
      value += simple[n] ?? n;
      i += 2;
      continue;
    }
    if (quote === "`" && c === "$" && source[i + 1] === "{") {
      throw new Error("template interpolation in the published schema was not expected");
    }
    if (c === quote) return { value, end: i + 1 };
    if (c === "\n" && quote !== "`") throw new Error("unterminated string literal in the published schema");
    value += c;
    i++;
  }
  throw new Error("unterminated string literal in the published schema");
}

function skipBlockComment(source: string, start: number): number {
  let i = start + 2;
  while (i < source.length) {
    if (source[i] === "*" && source[i + 1] === "/") return i + 2;
    i++;
  }
  throw new Error("unterminated block comment in the published schema");
}

function skipWsAndComments(source: string, index: number): number {
  let i = index;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      i += 2;
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    break;
  }
  return i;
}

const REGEX_BEFORE = new Set(["(", ",", "=", ":", "[", "{", "!", "&", "|", "?", "+", "-", "*", "~", "^", "%", "<", ">", ";"]);

function startsRegex(source: string, index: number): boolean {
  for (let j = index - 1; j >= 0; j--) {
    const c = source[j];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return c !== undefined && REGEX_BEFORE.has(c);
  }
  return true;
}

function skipRegexLiteral(source: string, start: number): { end: number; pattern: string; flags: string } {
  if (source[start] !== "/") throw new Error("expected a regex literal in the published schema");
  let i = start + 1;
  let pattern = "";
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === undefined) break;
    if (c === "\\") {
      const next = source[i + 1];
      if (next === undefined) throw new Error("unterminated regex escape in the published schema");
      pattern += `${c}${next}`;
      i += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      pattern += c;
      i++;
      continue;
    }
    if (c === "[") {
      inClass = true;
      pattern += c;
      i++;
      continue;
    }
    if (c === "/") {
      i++;
      let flags = "";
      while (i < source.length && /[a-z]/i.test(source[i] ?? "")) {
        flags += source[i];
        i++;
      }
      return { end: i, pattern, flags };
    }
    if (c === "\n") throw new Error("unterminated regex literal in the published schema");
    pattern += c;
    i++;
  }
  throw new Error("unterminated regex literal in the published schema");
}

function endOfFieldValue(source: string, start: number): number {
  let i = start;
  let depth = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = readStringLiteral(source, i).end;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      i = skipBlockComment(source, i);
      continue;
    }
    if (c === "/" && startsRegex(source, i)) {
      i = skipRegexLiteral(source, i).end;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      if (depth === 0) throw new Error("unbalanced delimiter in a VerifierRuntime field");
      depth--;
      i++;
      continue;
    }
    if (c === "}") {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    if (c === "," && depth === 0) return i;
    i++;
  }
  throw new Error("unterminated VerifierRuntime field");
}

function readPropertyName(source: string, start: number): { name: string; end: number } {
  const c = source[start];
  if (c === '"' || c === "'") {
    const literal = readStringLiteral(source, start);
    return { name: literal.value, end: literal.end };
  }
  if (c === undefined || !/[A-Za-z_$]/.test(c)) throw new Error("expected a VerifierRuntime property name");
  let i = start + 1;
  while (i < source.length && /[A-Za-z0-9_$]/.test(source[i] ?? "")) i++;
  return { name: source.slice(start, i), end: i };
}

function parseVerifierRuntime(source: string): { block: string; keys: string[]; values: Record<string, string> } {
  const marker = "export const VerifierRuntime = z.strictObject(";
  const at = source.indexOf(marker);
  if (at < 0) throw new Error("published schema has no export const VerifierRuntime = z.strictObject(");
  let i = skipWsAndComments(source, at + marker.length);
  if (source[i] !== "{") throw new Error("VerifierRuntime strictObject is missing its object literal");
  const open = i;
  i++;
  const keys: string[] = [];
  const values: Record<string, string> = {};
  while (i < source.length) {
    i = skipWsAndComments(source, i);
    if (source[i] === "}") return { block: source.slice(open, i + 1), keys, values };
    const name = readPropertyName(source, i);
    if (Object.hasOwn(values, name.name)) throw new Error(`duplicate VerifierRuntime key ${name.name}`);
    i = skipWsAndComments(source, name.end);
    if (source[i] !== ":") throw new Error(`expected ':' after ${name.name}`);
    i++;
    const valueEnd = endOfFieldValue(source, i);
    values[name.name] = source.slice(i, valueEnd).trim();
    keys.push(name.name);
    i = skipWsAndComments(source, valueEnd);
    if (source[i] === ",") {
      i++;
      continue;
    }
    i = skipWsAndComments(source, i);
    if (source[i] === "}") return { block: source.slice(open, i + 1), keys, values };
    throw new Error(`expected ',' or '}' after ${name.name}`);
  }
  throw new Error("VerifierRuntime object is unterminated");
}

function schemaField(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (value === undefined) throw new Error(`published VerifierRuntime is missing ${name}`);
  return value;
}

function publishedStorePrefix(source: string): string {
  const marker = "export const VERIFIER_STORE_PREFIX = ";
  const at = source.indexOf(marker);
  if (at < 0) throw new Error("published schema is missing VERIFIER_STORE_PREFIX");
  let i = at + marker.length;
  while (source[i] === " " || source[i] === "\t" || source[i] === "\n" || source[i] === "\r") i++;
  const literal = readStringLiteral(source, i);
  if (source.slice(literal.end, literal.end + " as const".length) !== " as const") {
    throw new Error("VERIFIER_STORE_PREFIX is not declared as const");
  }
  return literal.value;
}

function compileCallRegex(text: string): RegExp {
  const call = text.indexOf(".regex(");
  if (call < 0) throw new Error("published schema field is missing .regex(");
  let i = call + ".regex(".length;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  if (text[i] !== "/") throw new Error("published schema .regex() argument is not a regex literal");
  const literal = skipRegexLiteral(text, i);
  let j = literal.end;
  while (j < text.length && /\s/.test(text[j] ?? "")) j++;
  if (text[j] === ",") {
    j++;
    while (j < text.length && /\s/.test(text[j] ?? "")) j++;
  }
  if (text[j] !== ")") throw new Error("published schema .regex() call is not closed");
  return new RegExp(literal.pattern, literal.flags);
}

function compileFullSemver(source: string): RegExp {
  const marker = "const FullSemver =";
  const at = source.indexOf(marker);
  if (at < 0) throw new Error("published schema has no const FullSemver =");
  const semi = source.indexOf(";", at);
  if (semi < 0) throw new Error("FullSemver declaration is unterminated");
  return compileCallRegex(source.slice(at, semi + 1));
}

describe("published P1 VerifierRuntime schema", () => {
  const repoRoot = verifierRootFromModule(new URL("../src/verifier-deps.ts", import.meta.url));
  const runtimeKeys = [
    "vitest_location",
    "vitest_realpath",
    "vitest_version",
    "vitest_integrity",
    "lockfile_sha256",
  ];

  it("matches validateVerifierRuntime and the resolveLoadedVitest receipt", () => {
    const schema = readPublishedSchema(repoRoot);
    const prefix = publishedStorePrefix(schema);
    expect(prefix).toBe("/verifier/");
    expect(prefix).toBe(VERIFIER_STORE_PREFIX);
    expect(schema).toContain("function isVerifierRealpath(p");

    const parsed = parseVerifierRuntime(schema);
    expect(parsed.block).toContain('vitest_location: z.literal("verifier_store")');
    expect(parsed.block).toContain("vitest_realpath: z.string().max(400)");
    expect(parsed.block).toContain("isVerifierRealpath");
    expect(schemaField(parsed.values, "vitest_location").replace(/\s+/g, "")).toBe('z.literal("verifier_store")');
    expect(schemaField(parsed.values, "vitest_realpath").replace(/\s+/g, "")).toContain("z.string().max(400).refine(isVerifierRealpath");
    expect(schemaField(parsed.values, "vitest_version").replace(/\s+/g, "")).toBe("FullSemver");
    expect(parsed.keys).toEqual(runtimeKeys);

    const integrityPattern = compileCallRegex(schemaField(parsed.values, "vitest_integrity"));
    const lockPattern = compileCallRegex(schemaField(parsed.values, "lockfile_sha256"));
    const semverPattern = compileFullSemver(schema);
    const base64 = `${"A".repeat(84)}+/`;
    expect(base64).toHaveLength(86);

    const accepted: VerifierRuntime = {
      vitest_location: "verifier_store",
      vitest_realpath: "/verifier/node_modules/vitest/vitest.mjs",
      vitest_version: "1.2.3",
      vitest_integrity: `sha512-${base64}==`,
      lockfile_sha256: HEX,
    };
    expect(validateVerifierRuntime(accepted)).toBeNull();
    expect(Object.keys(accepted)).toEqual(runtimeKeys);

    withTemp((parent) => {
      const deps = join(parent, "deps");
      writeVitest(deps, "4.1.0-beta.1", INTEGRITY);
      const loaded = resolveLoadedVitest(deps, lockHash(deps));
      expect(validateVerifierRuntime(loaded)).toBeNull();
      expect(Object.keys(loaded)).toEqual(runtimeKeys);
      expect(parsed.keys.slice().sort()).toEqual(Object.keys(loaded).sort());
      expect(loaded.vitest_location).toBe("verifier_store");
      expect(loaded.vitest_realpath).toBe(`${prefix}node_modules/vitest/vitest.mjs`);
      expect(semverPattern.test(loaded.vitest_version)).toBe(true);
      expect(integrityPattern.test(loaded.vitest_integrity)).toBe(true);
      expect(lockPattern.test(loaded.lockfile_sha256)).toBe(true);
    });

    const rows: Array<{ field: "vitest_version" | "vitest_integrity" | "lockfile_sha256"; pattern: RegExp; sample: string; ok: boolean }> = [
      { field: "vitest_integrity", pattern: integrityPattern, sample: `sha512-${base64}==`, ok: true },
      { field: "vitest_integrity", pattern: integrityPattern, sample: INTEGRITY, ok: true },
      { field: "vitest_integrity", pattern: integrityPattern, sample: `sha256-${base64}==`, ok: false },
      { field: "vitest_integrity", pattern: integrityPattern, sample: "sha512-short", ok: false },
      { field: "vitest_integrity", pattern: integrityPattern, sample: `sha512-${base64}`, ok: false },
      { field: "lockfile_sha256", pattern: lockPattern, sample: HEX, ok: true },
      { field: "lockfile_sha256", pattern: lockPattern, sample: "f".repeat(64), ok: true },
      { field: "lockfile_sha256", pattern: lockPattern, sample: HEX.toUpperCase(), ok: false },
      { field: "lockfile_sha256", pattern: lockPattern, sample: HEX.slice(0, 63), ok: false },
      { field: "lockfile_sha256", pattern: lockPattern, sample: `sha256:${HEX}`, ok: false },
      { field: "vitest_version", pattern: semverPattern, sample: "1.2.3", ok: true },
      { field: "vitest_version", pattern: semverPattern, sample: "4.1.0-beta.1", ok: true },
      { field: "vitest_version", pattern: semverPattern, sample: "1.2.3+build", ok: true },
      { field: "vitest_version", pattern: semverPattern, sample: "01.2.3", ok: false },
      { field: "vitest_version", pattern: semverPattern, sample: "1.2", ok: false },
      { field: "vitest_version", pattern: semverPattern, sample: "v1.2.3", ok: false },
    ];
    for (const row of rows) {
      expect(row.pattern.test(row.sample), `${row.field} schema ${row.sample}`).toBe(row.ok);
      const reason = validateVerifierRuntime({ ...accepted, [row.field]: row.sample });
      expect(reason, `${row.field} validator ${row.sample}`).toBe(row.ok ? null : row.field);
    }

    const path401 = `${prefix}${"a".repeat(401 - prefix.length)}`;
    expect(path401).toHaveLength(401);
    expect(validateVerifierRuntime({ ...accepted, vitest_realpath: `${prefix}node_modules/vitest/vitest.mjs` })).toBeNull();
    const rejectedPaths = [
      "/verifier/",
      "/verifier/a/",
      "/verifier/a//b",
      "/verifier/./a",
      "/verifier/../a",
      "/verifier/a\\b",
      "/verifier/a%2e",
      "/home/x/vitest.mjs",
      "C:/x",
      path401,
    ];
    for (const sample of rejectedPaths) {
      expect(validateVerifierRuntime({ ...accepted, vitest_realpath: sample }), sample).toBe("vitest_realpath");
    }

    const depsSource = readFileSync(fileURLToPath(new URL("../src/verifier-deps.ts", import.meta.url)), "utf8");
    expect(depsSource).not.toContain("toP1VerifierRuntime");
  });
});
