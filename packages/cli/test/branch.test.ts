import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { branchExists, branchName, fixBranch, gitBase } from "../src/security/branch.ts";
import { dependencyFixPublished } from "../src/security/exposure.ts";
import { snapshot } from "../src/security/project.ts";
import { commit, git } from "./git.ts";

function project(): { root: string; copy: string } {
  const root = mkdtempSync(join(tmpdir(), "ludion-branch-test-"));
  writeFileSync(join(root, "package.json"), "{}\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "index.js"), "module.exports = 1;\n");
  commit(root);
  const copy = mkdtempSync(join(tmpdir(), "ludion-branch-copy-"));
  snapshot(root, copy);
  return { root, copy };
}

describe("a fix on its own branch", () => {
  it("commits only the given files on HEAD, on a new branch, and leaves the working tree and HEAD alone", () => {
    const { root, copy } = project(), head = git(root, "rev-parse", "HEAD");
    const base = gitBase(root, copy);
    expect(base).toMatchObject({ commit: head, prefix: "" });
    const made = fixBranch(base, "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{\"x\":1}\n" }], "ludion: x 1.0.0 -> 1.0.1 (npm)\n");
    expect(git(root, "rev-parse", "ludion/npm/x-1.0.1")).toBe(made);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "diff", "--name-only", head, made)).toBe("package.json");
    expect(git(root, "log", "-1", "--format=%an <%ae>%n%s", made)).toBe("Ludion <ludion@ludion.invalid>\nludion: x 1.0.0 -> 1.0.1 (npm)");
    expect(readFileSync(join(root, "package.json"), "utf8")).toBe("{}\n");
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(branchExists(base, "ludion/npm/x-1.0.1")).toBe(true);
    // An existing branch is never moved.
    expect(() => fixBranch(base, "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{\"x\":2}\n" }], "again")).toThrow();
    expect(git(root, "rev-parse", "ludion/npm/x-1.0.1")).toBe(made);
  });
  it("compares the validated copy with HEAD, file by file", () => {
    const { root, copy } = project();
    writeFileSync(join(copy, "extra.txt"), "x");
    expect(() => gitBase(root, copy)).toThrow("differ from it: extra.txt");
    const second = project();
    writeFileSync(join(second.copy, "src", "index.js"), "module.exports = 2;\n");
    expect(() => gitBase(second.root, second.copy)).toThrow("differ from it: src/index.js");
    const third = project();
    git(third.root, "rm", "-q", "src/index.js"); git(third.root, "commit", "-qm", "rm");
    expect(() => gitBase(third.root, third.copy)).toThrow("differ from it: src/index.js");
    // CRLF line ends alone (a checkout with core.autocrlf) are not a difference; names given as left out are not compared.
    const fourth = project();
    writeFileSync(join(fourth.copy, "src", "index.js"), "module.exports = 1;\r\n");
    mkdirSync(join(fourth.copy, "vendor")); writeFileSync(join(fourth.copy, "vendor", "autoload.php"), "<?php");
    expect(() => gitBase(fourth.root, fourth.copy, ["vendor"])).not.toThrow();
    expect(() => gitBase(fourth.root, fourth.copy)).toThrow("vendor/autoload.php");
  });
  it("refuses a folder outside Git and a repository with no commit", () => {
    const plain = mkdtempSync(join(tmpdir(), "ludion-branch-plain-"));
    expect(() => gitBase(plain, plain)).toThrow("not in a Git work tree");
    git(plain, "init", "-q");
    expect(() => gitBase(plain, mkdtempSync(join(tmpdir(), "ludion-branch-empty-")))).toThrow("no commit");
  });
  it.skipIf(process.platform === "win32")("runs none of the repository's hooks, fsmonitor, signing program or filters", () => {
    const { root, copy } = project(), marks = mkdtempSync(join(tmpdir(), "ludion-branch-marks-"));
    const script = (name: string) => {
      const path = join(marks, `${name}.sh`);
      writeFileSync(path, `#!/bin/sh\ntouch "${join(marks, `${name}.ran`)}"\ncat >/dev/null\n`);
      chmodSync(path, 0o755);
      return path;
    };
    // Every file goes through a filter driver; the driver's commands are set after this commit.
    writeFileSync(join(root, ".gitattributes"), "* filter=evil\n");
    writeFileSync(join(copy, ".gitattributes"), "* filter=evil\n");
    git(root, "add", ".gitattributes"); git(root, "commit", "-qm", "attributes");
    const install = (dir: string, hook: string, name = hook) => { writeFileSync(join(dir, hook), readFileSync(script(name))); chmodSync(join(dir, hook), 0o755); };
    for (const hook of ["reference-transaction", "post-commit", "pre-commit", "post-index-change"]) install(join(root, ".git", "hooks"), hook);
    const hooksPath = join(marks, "hooks-path"); mkdirSync(hooksPath);
    install(hooksPath, "reference-transaction", "hooks-path");
    git(root, "config", "core.hooksPath", hooksPath);
    git(root, "config", "core.fsmonitor", script("fsmonitor"));
    git(root, "config", "commit.gpgSign", "true");
    git(root, "config", "gpg.program", script("gpg"));
    git(root, "config", "filter.evil.clean", script("clean"));
    git(root, "config", "filter.evil.smudge", script("smudge"));
    const base = gitBase(root, copy);
    fixBranch(base, "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{\"x\":1}\n" }], "ludion: x");
    expect(git(root, "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "cat-file", "-p", "ludion/npm/x-1.0.1:package.json")).toBe("{\"x\":1}");
    expect(["reference-transaction", "post-commit", "pre-commit", "post-index-change", "hooks-path", "fsmonitor", "gpg", "clean", "smudge"].filter(name => existsSync(join(marks, `${name}.ran`)))).toEqual([]);
    // The control: plain Git does run the configured hook, so the check above can see one.
    git(root, "update-ref", "refs/heads/control", "HEAD");
    expect(existsSync(join(marks, "hooks-path.ran"))).toBe(true);
  });
  it("makes branch names Git accepts", () => {
    expect(branchName("ludion", "apps/web/", "npm", "@scope/pkg-1.2.3")).toBe("ludion/apps-web/npm/scope-pkg-1.2.3");
    expect(branchName("ludion", "composer", "vendor/x..y.lock")).toBe("ludion/composer/vendor-x.y-lock");
    expect(branchName("ludion", "..", "php", "8.4.28")).toBe("ludion/x/php/8.4.28");
  });
});

describe("the fix's official publish time", () => {
  it("is the registry's time, or null with the reason", async () => {
    const npm: typeof fetch = async () => new Response(JSON.stringify({ time: { created: "2012-01-01T00:00:00.000Z", "1.0.1": "2026-01-02T03:04:05.000Z" }, versions: { "1.0.1": {} } }));
    const change = { name: "x", from: "1.0.0", to: "1.0.1", advisories: ["A"] };
    expect(await dependencyFixPublished("npm", [change], npm)).toEqual({ at: "2026-01-02T03:04:05.000Z", note: "registry.npmjs.org's publish time of the fixed version." });
    expect((await dependencyFixPublished("npm", [change], async () => new Response("", { status: 503 }))).at).toBeNull();
    expect((await dependencyFixPublished("npm", [{ ...change, to: "1.0.2" }], npm)).note).toBe("Not found: the registry gives no publish time for x@1.0.2.");
    expect(await dependencyFixPublished("maven", [change])).toEqual({ at: null, note: "Not read: Ludion does not read Maven Central's publish times yet." });
    const packagist: typeof fetch = async () => new Response(JSON.stringify({ packages: { "vendor/x": [{ version: "v1.0.1", time: "2026-01-02T03:04:05+00:00" }] } }));
    expect(await dependencyFixPublished("composer", [{ ...change, name: "vendor/x", to: "v1.0.1" }], packagist)).toEqual({ at: "2026-01-02T03:04:05.000Z", note: "Packagist's release date of the fixed version, which its author sets." });
  });
});
