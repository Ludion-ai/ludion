import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { branchName, branchSubject, fixBranch, gitBase } from "../src/security/branch.ts";
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
    expect(branchSubject(base, "ludion/npm/x-1.0.1")).toBe("ludion: x 1.0.0 -> 1.0.1 (npm)");
    expect(branchSubject(base, "ludion/npm/none")).toBeNull();
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
  it.skipIf(process.platform === "win32")("never runs a git program from the project's folder", () => {
    // Windows looks for git.exe in the child's working directory before PATH; "." on PATH does the same here.
    const { root } = project(), marks = mkdtempSync(join(tmpdir(), "ludion-branch-marks-"));
    writeFileSync(join(root, "git"), `#!/bin/sh\ntouch "${join(marks, "project-git.ran")}"\nexit 1\n`);
    chmodSync(join(root, "git"), 0o755);
    commit(root);
    const copy = mkdtempSync(join(tmpdir(), "ludion-branch-copy-")); snapshot(root, copy);
    const path = process.env.PATH;
    process.env.PATH = `.:${path}`;
    try {
      fixBranch(gitBase(root, copy), "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{}\n" }], "ludion: x");
      expect(existsSync(join(marks, "project-git.ran"))).toBe(false);
      // The control: started in the project's folder, the project's git is the one that runs.
      spawnSync("git", ["--version"], { cwd: root });
      expect(existsSync(join(marks, "project-git.ran"))).toBe(true);
    } finally { process.env.PATH = path; }
  });
  it("ignores GIT_DIR, GIT_INDEX_FILE and GIT_CONFIG_PARAMETERS inherited from the environment", () => {
    const { root, copy } = project(), other = project(), saved = { ...process.env };
    Object.assign(process.env, { GIT_DIR: join(other.root, ".git"), GIT_INDEX_FILE: join(tmpdir(), "ludion-no-such-index"), GIT_CONFIG_PARAMETERS: "'core.hookspath'='/nonexistent'" });
    try {
      const base = gitBase(root, copy);
      expect(base.commit).toBe(git(root, "--git-dir", join(root, ".git"), "rev-parse", "HEAD"));
      fixBranch(base, "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{}\n" }], "ludion: x");
    } finally { for (const key of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_CONFIG_PARAMETERS"]) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    expect(git(root, "rev-parse", "--verify", "ludion/npm/x-1.0.1")).toMatch(/^[0-9a-f]{40}$/);
    expect(git(other.root, "branch", "--list", "ludion/*")).toBe("");
  });
  it.skipIf(process.platform === "win32")("refuses a symbolic link in HEAD, and an executable bit or a binary file that differs", () => {
    const first = project();
    symlinkSync("package.json", join(first.root, "link")); commit(first.root);
    expect(() => gitBase(first.root, first.copy)).toThrow("a symbolic link at link");
    const second = project();
    chmodSync(join(second.copy, "package.json"), 0o755);
    expect(() => gitBase(second.root, second.copy)).toThrow("differ from it: package.json");
    const third = project();
    writeFileSync(join(third.root, "data.bin"), Buffer.from("a\0\nb")); commit(third.root);
    writeFileSync(join(third.copy, "data.bin"), Buffer.from("a\0\r\nb"));
    expect(() => gitBase(third.root, third.copy)).toThrow("differ from it: data.bin");
  });
  it("refuses a repository whose configuration names hooks, which newer Git runs whatever core.hooksPath says", () => {
    const { root, copy } = project();
    git(root, "config", "hook.audit.event", "reference-transaction");
    git(root, "config", "hook.audit.command", "true");
    expect(() => gitBase(root, copy)).toThrow("names hooks (hook.audit.event, hook.audit.command)");
  });
  it("checks the configuration again before each branch", () => {
    const { root, copy } = project(), base = gitBase(root, copy);
    git(root, "config", "hook.late.command", "true");
    expect(() => fixBranch(base, "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{}\n" }], "ludion: x")).toThrow("names hooks (hook.late.command)");
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
  it.skipIf(process.platform === "win32")("never fetches a missing object with the repository's own transport command", () => {
    // A partial clone whose HEAD commit is missing locally: Git would fetch it, running remote.origin.uploadpack.
    const origin = project(), marks = mkdtempSync(join(tmpdir(), "ludion-branch-marks-"));
    const root = mkdtempSync(join(tmpdir(), "ludion-branch-partial-"));
    git(root, "init", "-q");
    writeFileSync(join(root, ".git", "refs", "heads", "main"), `${git(origin.root, "rev-parse", "HEAD")}\n`);
    for (const [key, value] of [["core.repositoryformatversion", "1"], ["extensions.partialClone", "origin"], ["remote.origin.url", origin.root], ["remote.origin.promisor", "true"], ["remote.origin.uploadpack", `touch "${join(marks, "uploadpack.ran")}"; git-upload-pack`], ["protocol.file.allow", "always"]]) git(root, "config", key!, value!);
    // A partial clone is refused. The transport settings behind the refusal stop the fetch even with the repository's
    // protocol.file.allow=always, which wins over protocol.allow (docs/bench/2026-10-29-la-per-fix-apply/logs/transport-probe.log).
    expect(() => gitBase(root, mkdtempSync(join(tmpdir(), "ludion-branch-empty-")))).toThrow("partial clone (extensions.partialclone, remote.origin.promisor)");
    expect(existsSync(join(marks, "uploadpack.ran"))).toBe(false);
    // The control: plain Git fetches it, and runs the command.
    spawnSync("git", ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], { cwd: root });
    expect(existsSync(join(marks, "uploadpack.ran"))).toBe(true);
  });
  it("commits a file the working tree has only with CRLF ends with LF ends, as HEAD has it, and only paths HEAD has", () => {
    const { root, copy } = project(), head = git(root, "rev-parse", "HEAD");
    writeFileSync(join(copy, "package.json"), "{}\r\n");
    const base = gitBase(root, copy);
    expect([...base.crlf]).toEqual(["package.json"]);
    const made = fixBranch(base, "ludion/npm/x-1.0.1", [{ path: "package.json", content: "{\r\n  \"x\": 1\r\n}\r\n" }], "ludion: x");
    expect(git(root, "cat-file", "blob", `${made}:package.json`)).toBe("{\n  \"x\": 1\n}");
    expect(git(root, "diff", "--name-only", head, made)).toBe("package.json");
    expect(() => fixBranch(base, "ludion/npm/x-1.0.2", [{ path: "Package.json", content: "{}\n" }], "ludion: x")).toThrow("The last commit has no Package.json");
  });
  it("refuses a submodule in HEAD and a work tree Git places elsewhere", () => {
    const first = project(), commitId = git(first.root, "rev-parse", "HEAD");
    git(first.root, "update-index", "--add", "--cacheinfo", "160000", commitId, "sub"); git(first.root, "commit", "-qm", "submodule");
    expect(() => gitBase(first.root, first.copy)).toThrow("a submodule at sub");
    const second = project();
    git(second.root, "config", "core.worktree", mkdtempSync(join(tmpdir(), "ludion-branch-elsewhere-")));
    expect(() => gitBase(second.root, second.copy)).toThrow();
  });
  it("makes branch names Git accepts", () => {
    const long = `io.opentelemetry.instrumentation:${"x".repeat(200)}-2.10.0`;
    expect(branchName("ludion", "maven", long)).not.toBe(branchName("ludion", "maven", long.replace("2.10.0", "2.10.1")));
    expect(branchName("ludion", "maven", long).split("/")[2]!.length).toBeLessThanOrEqual(200);
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
