import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compare, parseReleases, phpImage, replaceImage, scanPhp } from "../src/security/php.ts";
import { DEFAULT_CONFIG, readConfig, snapshot } from "../src/security/project.ts";
import { patchProject, type Command } from "../src/security/patch.ts";
import { runArgs } from "../../sandbox/src/docker.ts";
import { phpFixPublished } from "../src/security/exposure.ts";
import { commit, git } from "./git.ts";

const SOURCE = "FROM php:8.4.25-cli-alpine\nWORKDIR /app\nCOPY . .\n";
const releases = {
  "8.4.28": { date: "29 Oct 2026", tags: [] },
  "8.4.27": { date: "21 Oct 2026", tags: ["security"] },
  "8.4.25": { date: "27 Aug 2026", tags: [] },
  "8.5.12": { date: "21 Oct 2026", tags: ["security"] },
};
const fetchFn: typeof fetch = async () => new Response(JSON.stringify(releases));
const DIGEST = `sha256:${"a".repeat(64)}`;
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-security-test-"));
  writeFileSync(join(root, "Dockerfile"), SOURCE);
  writeFileSync(join(root, "ludion.security.json"), JSON.stringify(DEFAULT_CONFIG));
  commit(root);
  return root;
}
const command: Command = async args => args.includes("{{.Id}}") ? DIGEST : args[0] === "image" && args[1] === "inspect" ? JSON.stringify([`php@${DIGEST}`]) : "";
const testRun = async () => {};

describe("official PHP security update decisions", () => {
  it("keeps the branch and flavor, choosing the branch's newest release, 8.4.28, though only 8.4.27 is tagged security", async () => {
    const result = await scanPhp(SOURCE, fetchFn);
    expect(result.status).toBe("update_available");
    expect(result.candidate).toEqual({ version: "8.4.28", reference: "php:8.4.28-cli-alpine" });
    expect(result.security_releases.map(r => r.version)).toEqual(["8.4.27"]);
    expect(compare("8.4.9", "8.4.10")).toBeLessThan(0);
  });
  it("does not call no match secure, and does not move from the branch's newest release", async () => {
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.28"), fetchFn);
    expect(result.status).toBe("no_newer_security_release");
    expect(result.candidate).toBeNull();
    expect(result.note).toContain("not a security guarantee");
  });
  // docs/decisions/2026-10-31-limgv-official-image-newest-release.md: a sample shaped like php.net's JSON (made up, not
  // fetched), newest first: 8.4.28 and 8.4.26 tagged security, and 8.4.30, 8.4.29, 8.4.27 and 8.4.25 not. Only the branch's
  // newest tag, 8.4.30, is still rebuilt by Docker's official image.
  const sample = readFileSync(new URL("./fixtures/php-releases-8.4.json", import.meta.url), "utf8");
  const sampleFetch: typeof fetch = async () => new Response(sample);
  it.each([
    // 8.4.24 is not in the list (php.net's lists skip versions); the newest release is still known to be newer.
    ["8.4.24", ["8.4.28", "8.4.26"]],
    ["8.4.25", ["8.4.28", "8.4.26"]],
    ["8.4.26", ["8.4.28"]],
    ["8.4.27", ["8.4.28"]],
  ])("from php:%s takes the branch's newest release, 8.4.30, which is not tagged security", async (from, fixes) => {
    const result = await scanPhp(SOURCE.replace("8.4.25", from), sampleFetch);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.30", reference: "php:8.4.30-cli-alpine" } });
    expect(result.security_releases.map(r => r.version)).toEqual(fixes);
    // The exposure-time start stays the first newer security release's day.
    expect(phpFixPublished(result).at).toBe(fixes.at(-1) === "8.4.26" ? "2026-09-11T00:00:00.000Z" : "2026-10-09T00:00:00.000Z");
  });
  it.each(["8.4.28", "8.4.29"])("from php:%s, no longer the branch's newest release, moves to 8.4.30 with no newer security release", async from => {
    const result = await scanPhp(SOURCE.replace("8.4.25", from), sampleFetch);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.30", reference: "php:8.4.30-cli-alpine" }, security_releases: [] });
    expect(phpFixPublished(result)).toEqual({ at: null, note: "Not found: php.net lists no security release newer than the Dockerfile's version." });
  });
  it("from php:8.4.30, the branch's newest release, finds no candidate", async () => {
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.30"), sampleFetch);
    expect(result).toMatchObject({ status: "no_newer_security_release", candidate: null, security_releases: [] });
  });
  // The day the tag stops being the newest: the sample as php.net would have listed it up to a day. php:8.4.28, the newest
  // release and tagged security, stays while it is the newest, and moves on the day 8.4.29, not tagged security, is listed.
  const upTo = (last: string): typeof fetch => async () => new Response(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(sample)).filter(([v]) => compare(v, last) <= 0))));
  it("moves on the day a later release makes the tag no longer the branch's newest", async () => {
    const from = SOURCE.replace("8.4.25", "8.4.28");
    expect(await scanPhp(from, upTo("8.4.28"))).toMatchObject({ status: "no_newer_security_release", candidate: null });
    expect(await scanPhp(from, upTo("8.4.29"))).toMatchObject({ status: "update_available", candidate: { version: "8.4.29", reference: "php:8.4.29-cli-alpine" }, security_releases: [] });
  });
  // A list with no release as new as the Dockerfile's is missing releases: whether the tag is the newest cannot be read.
  it.each([["8.4.31", sampleFetch], ["8.4.29", upTo("8.4.28")], ["8.4.100", sampleFetch]] as const)("stops when php.net's list has no release as new as php:%s", async (from, lookup) => {
    await expect(scanPhp(SOURCE.replace("8.4.25", from), lookup)).rejects.toThrow(`The official PHP 8.4 release list has no release as new as ${from}; it is missing releases. No update decision was made.`);
  });
  // The same made-up sample with its entries oldest first, as php.net's JSON is not promised to be in order: the choice
  // must not come from the response's order, which would give its last entry, 8.4.25 (R237 finding 1).
  const reversedFetch: typeof fetch = async () => new Response(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(sample)).reverse())));
  it("takes the same newest release when php.net lists its releases oldest first", async () => {
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.24"), reversedFetch);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.30", reference: "php:8.4.30-cli-alpine" } });
    expect(result.security_releases.map(r => r.version)).toEqual(["8.4.28", "8.4.26"]);
  });
  // The made-up sample with a newer 8.4.31 whose tags are not "security": php.net's own [""] (its 8.4 list on 2026-10-31
  // tags 8.4.25 so) and a made-up tag. 8.4.31 is the newest release and so the candidate, but not a security release: it
  // is not among the security releases and gives no exposure-time start (R237 finding 2).
  it.each([[[""]], [["bugfix"]]])("does not count a release tagged %j as a security release", async tags => {
    const lookup: typeof fetch = async () => new Response(JSON.stringify({ "8.4.31": { tags, date: "31 Oct 2026" }, ...JSON.parse(sample) }));
    const result = await scanPhp(SOURCE, lookup);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.31", reference: "php:8.4.31-cli-alpine" } });
    expect(result.security_releases.map(r => r.version)).toEqual(["8.4.28", "8.4.26"]);
    expect(await scanPhp(SOURCE.replace("8.4.25", "8.4.30"), lookup)).toMatchObject({ status: "update_available", candidate: { version: "8.4.31" }, security_releases: [] });
  });
  // Made up: from 8.4.9, the releases 8.4.10 and 8.4.11 are newer by number though "8.4.10" < "8.4.9" as text, so the scan
  // must find them and neither report the silent "no update" nor stop (R237 finding 3).
  it.each([
    [{ "8.4.11": { tags: [], date: "06 Nov 2026" }, "8.4.10": { tags: ["security"], date: "23 Oct 2026" }, "8.4.9": { tags: [], date: "09 Oct 2026" } }, "8.4.11", ["8.4.10"]],
    [{ "8.4.10": { tags: [], date: "23 Oct 2026" }, "8.4.9": { tags: [], date: "09 Oct 2026" } }, "8.4.10", []],
  ])("compares versions by number in the scan, across a digit boundary (%#)", async (releases, to, fixes) => {
    const result = await scanPhp("FROM php:8.4.9-cli\n", async () => new Response(JSON.stringify(releases)));
    expect(result).toMatchObject({ status: "update_available", candidate: { version: to, reference: `php:${to}-cli` } });
    expect(result.security_releases.map(r => r.version)).toEqual(fixes);
  });
  it.each(["FROM php:8.4-cli\n", "ARG PHP=8.4.25\nFROM php:${PHP}-cli\n", "FROM evil/php:8.4.25-cli\n", "FROM php:8.4.25-cli\nFROM scratch\n", "FROM php:8.4.25-cli AS build\n", "# syntax=evil/build\nFROM php:8.4.25-cli\n", "FROM php:8.4.25-cli\nADD https://example.com/app /app\n", "FROM php:8.4.25-cli\nCOPY --from=evil / /app\n", "FROM php:8.4.25-cli\nRUN --network=host true\n", `FROM php:8.4.25-cli@sha256:${"a".repeat(63)}\n`, `FROM php:8.4.25-cli@md5:${"a".repeat(32)}\n`, "\u{FEFF}\u{FEFF}FROM php:8.4.25-cli\nFROM scratch\n"])("refuses ambiguous or external build input: %s", text => {
    expect(() => phpImage(text)).toThrow();
  });
  it("refuses a PHP flavor that does not follow a hyphen", () => {
    expect(() => phpImage("FROM php:8.4.26cli\n")).toThrow("PHP image flavor must follow a hyphen.");
  });
  it("handles official pinned images and changes only FROM", () => {
    const original = `# php:8.4.25-cli is old\nFROM docker.io/library/php:8.4.25-cli@${DIGEST}\nRUN echo php:8.4.25-cli\n`;
    const image = phpImage(original);
    expect(replaceImage(original, image, "php:8.4.28-cli")).toBe("# php:8.4.25-cli is old\nFROM php:8.4.28-cli\nRUN echo php:8.4.25-cli\n");
  });
  it("fails closed on unavailable, oversized and malformed official metadata", async () => {
    await expect(scanPhp(SOURCE, async () => new Response("", { status: 503 }))).rejects.toThrow("HTTP 503");
    await expect(scanPhp(SOURCE, async () => new Response(" ".repeat(1024 * 1024 + 1)))).rejects.toThrow("1 MiB");
    expect(() => parseReleases({ "8.4.27": { tags: ["security"] } }, "8.4")).toThrow("Incomplete");
    expect(() => parseReleases({}, "8.1")).toThrow("not interpret this as safe");
  });
});

describe("bounded patch application and evidence", () => {
  it("validates without changing source by default; commits only FROM on its own branch when explicitly enabled", async () => {
    for (const apply of [false, true]) {
      const root = fixture(), head = git(root, "rev-parse", "HEAD"), before = snapshot(root), calls: string[][] = [];
      const result = await patchProject(root, apply, { fetchFn, command: async (args, timeout) => { calls.push(args); return command(args, timeout); }, testRun });
      expect(result.receipt?.outcome).toBe(apply ? "applied" : "validated");
      expect(result.receipt?.baseline_passed).toBe(true);
      expect(result.receipt?.candidate_passed).toBe(true);
      expect(result.receipt?.scope).toBe("dockerfile_only_not_deployed");
      expect(result.path && JSON.parse(readFileSync(result.path, "utf8")).outcome).toBe(apply ? "applied" : "validated");
      expect(calls.filter(a => a[0] === "build").every(a => a.includes("--network=none"))).toBe(true);
      // The candidate is 8.4.28, the branch's newest release; 8.4.27 is the first security release newer than 8.4.25, and php.net gives its day.
      expect(result.receipt).toMatchObject({ fix_published_at: "2026-10-21T00:00:00.000Z", found_at: result.scan.checked_at });
      // The working tree is never changed.
      expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
      expect(snapshot(root)).toBe(before);
      if (apply) {
        expect(result.receipt).toMatchObject({ base_commit: head, branch: "ludion/php/8.4.28", commit: git(root, "rev-parse", "ludion/php/8.4.28") });
        expect(result.receipt?.applied_at).toBeTruthy();
        expect(git(root, "show", "ludion/php/8.4.28:Dockerfile") + "\n").toBe(SOURCE.replace("php:8.4.25-cli-alpine", `php:8.4.28-cli-alpine@${DIGEST}`));
        expect(git(root, "rev-parse", "ludion/php/8.4.28^")).toBe(head);
      } else expect(result.receipt).toMatchObject({ base_commit: null, branch: null, commit: null, applied_at: null });
      expect(existsSync(join(root, ".ludion/security/patch.lock"))).toBe(false);
    }
  });
  it("leaves an existing branch unchanged and runs no Docker work for it", async () => {
    const root = fixture();
    const first = await patchProject(root, true, { fetchFn, command, testRun });
    let docker = 0;
    const second = await patchProject(root, true, { fetchFn, command: async (args, timeout) => { docker++; return command(args, timeout); }, testRun });
    expect(second.receipt).toMatchObject({ outcome: "skipped", branch: "ludion/php/8.4.28", commit: null });
    expect(docker).toBe(0);
    expect(git(root, "rev-parse", "ludion/php/8.4.28")).toBe(first.receipt?.commit);
  });
  it("stops when the branch name already holds another change, and leaves that branch alone", async () => {
    const root = fixture(), head = git(root, "rev-parse", "HEAD");
    git(root, "branch", "ludion/php/8.4.28", head);
    let docker = 0;
    const result = await patchProject(root, true, { fetchFn, command: async (args, timeout) => { docker++; return command(args, timeout); }, testRun });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("holds another change (\"fixture\")");
    expect(docker).toBe(0);
    expect(git(root, "rev-parse", "ludion/php/8.4.28")).toBe(head);
  });
  it("applies when the config names the Dockerfile as ./Dockerfile", async () => {
    const root = fixture();
    writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ ...DEFAULT_CONFIG, dockerfile: "./Dockerfile" }));
    commit(root);
    const result = await patchProject(root, true, { fetchFn, command, testRun });
    expect(result.receipt).toMatchObject({ outcome: "applied", branch: "ludion/php/8.4.28" });
  });
  it("commits a Dockerfile checked out with CRLF ends with LF ends, as the last commit has it", async () => {
    const root = fixture();
    writeFileSync(join(root, "Dockerfile"), SOURCE.replace(/\n/g, "\r\n"));
    const result = await patchProject(root, true, { fetchFn, command, testRun });
    expect(result.receipt?.outcome).toBe("applied");
    expect(git(root, "cat-file", "blob", "ludion/php/8.4.28:Dockerfile") + "\n").toBe(SOURCE.replace("php:8.4.25-cli-alpine", `php:8.4.28-cli-alpine@${DIGEST}`));
  });
  it("moves php:8.4.27, no longer the branch's newest release, to 8.4.28 with no newer security release, and says so", async () => {
    const root = fixture();
    writeFileSync(join(root, "Dockerfile"), SOURCE.replace("8.4.25", "8.4.27"));
    commit(root);
    const result = await patchProject(root, true, { fetchFn, command, testRun });
    expect(result.receipt).toMatchObject({ outcome: "applied", branch: "ludion/php/8.4.28", fix_published_at: null, scan: { security_releases: [] } });
    expect(git(root, "show", "ludion/php/8.4.28:Dockerfile") + "\n").toBe(SOURCE.replace("php:8.4.25-cli-alpine", `php:8.4.28-cli-alpine@${DIGEST}`));
    expect(git(root, "log", "-1", "--format=%B", "ludion/php/8.4.28")).toContain("ludion: PHP 8.4.27 -> 8.4.28 in Dockerfile\n\nNo official PHP security release is newer than 8.4.27; 8.4.28 is the newest release of its line, the only tag of the line Docker's official image still rebuilds.\n\nLudion receipt ");
  });
  it("refuses --apply outside Git or with files that differ from the last commit, before Docker", async () => {
    const plain = mkdtempSync(join(tmpdir(), "ludion-security-plain-"));
    writeFileSync(join(plain, "Dockerfile"), SOURCE);
    writeFileSync(join(plain, "ludion.security.json"), JSON.stringify(DEFAULT_CONFIG));
    let docker = 0;
    const counted: Command = async (args, timeout) => { docker++; return command(args, timeout); };
    expect((await patchProject(plain, true, { fetchFn, command: counted, testRun })).receipt?.reason).toContain("not in a Git work tree");
    const dirty = fixture(); writeFileSync(join(dirty, "Dockerfile"), `${SOURCE}RUN true\n`);
    expect((await patchProject(dirty, true, { fetchFn, command: counted, testRun })).receipt?.reason).toContain("differ from it: Dockerfile");
    expect(docker).toBe(0);
  });
  it("records the fix's php.net date as null when it cannot be read", async () => {
    const scan = await scanPhp(SOURCE, fetchFn);
    expect(phpFixPublished({ ...scan, security_releases: [{ version: "8.4.27", date: "2026-10-21", security: true }] })).toMatchObject({ at: null });
    expect(phpFixPublished({ ...scan, security_releases: [{ version: "8.4.27", date: "31 Feb 2026", security: true }] })).toMatchObject({ at: null });
    expect(phpFixPublished({ ...scan, security_releases: [] }).note).toContain("Not found");
  });
  it.each([1, 2, 3, 4])("blocks an update when validation step %s fails", async failureAt => {
    const root = fixture(); let count = 0;
    const result = await patchProject(root, true, { fetchFn, command, testRun: async () => { if (++count === failureAt) throw new Error("test failure"); } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
  });
  it.each([false, true])("refuses a fresh validation result when included source changed (apply=%s)", async apply => {
    const root = fixture(); let count = 0;
    const result = await patchProject(root, apply, { fetchFn, command, testRun: async () => { if (++count === 4) writeFileSync(join(root, "new-source.php"), "<?php"); } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("Project changed");
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
  });
  it.each(["add", "remove"])("blocks a change to an empty source directory: %s", async operation => {
    const root = fixture(); let count = 0;
    const path = join(root, "empty");
    if (operation === "remove") mkdirSync(path);
    const result = await patchProject(root, true, { fetchFn, command, testRun: async () => {
      if (++count === 4) { if (operation === "add") mkdirSync(path); else rmdirSync(path); }
    } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("Project changed");
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
  });
  it.skipIf(process.platform === "win32")("hashes and preserves directory and file permissions", () => {
    const root = fixture(), destination = mkdtempSync(join(tmpdir(), "ludion-security-mode-"));
    mkdirSync(join(root, "empty"), { mode: 0o750 });
    chmodSync(join(root, "Dockerfile"), 0o751);
    const before = snapshot(root, destination);
    expect(lstatSync(join(destination, "empty")).mode & 0o777).toBe(0o750);
    expect(lstatSync(join(destination, "Dockerfile")).mode & 0o777).toBe(0o751);
    expect(snapshot(destination)).toBe(before);
    chmodSync(join(root, "empty"), 0o700);
    expect(snapshot(root)).not.toBe(before);
  });
  it.each([1, 2, 3, 4])("cancellation during validation step %s blocks application", async cancelAt => {
    const root = fixture(), abort = new AbortController(); let count = 0;
    const result = await patchProject(root, true, { signal: abort.signal, fetchFn, command, testRun: async () => { if (++count === cancelAt) abort.abort(); } });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("cancelled");
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
  });
  it("cannot accept an image digest from another repository", async () => {
    const root = fixture();
    const result = await patchProject(root, true, { fetchFn, command: async () => JSON.stringify([`evil/php@${DIGEST}`]), testRun });
    expect(result.receipt?.outcome).toBe("failed");
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
  });
  it("blocks a policy change during the metadata lookup before starting Docker", async () => {
    const root = fixture(); let dockerCalled = false;
    const result = await patchProject(root, true, {
      fetchFn: async () => { writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ ...DEFAULT_CONFIG, test: ["php", "different.php"] })); return new Response(JSON.stringify(releases)); },
      command: async () => { dockerCalled = true; return ""; }, testRun,
    });
    expect(result.receipt?.reason).toContain("policy changed");
    expect(dockerCalled).toBe(false);
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
  });
  it("records an unavailable Docker environment without applying or leaving a lock", async () => {
    const root = fixture();
    const result = await patchProject(root, true, { fetchFn, command: async () => { throw new Error("Docker unavailable"); }, testRun });
    expect(result.receipt?.outcome).toBe("failed");
    expect(result.receipt?.reason).toContain("Docker unavailable");
    expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
    expect(existsSync(join(root, ".ludion/security/patch.lock"))).toBe(false);
  });
  it("keeps secrets and receipts out of the source snapshot", () => {
    const root = fixture(), before = snapshot(root);
    writeFileSync(join(root, ".env"), "TOP_SECRET=fixture");
    expect(snapshot(root)).toBe(before);
  });
  it("rejects config path traversal and empty or unknown test settings", () => {
    const root = fixture();
    for (const config of [{ ...DEFAULT_CONFIG, dockerfile: "../Dockerfile" }, { ...DEFAULT_CONFIG, test: [] }, { ...DEFAULT_CONFIG, autoDeploy: true }]) {
      writeFileSync(join(root, "ludion.security.json"), JSON.stringify(config));
      expect(() => readConfig(root)).toThrow();
    }
  });
  it("runs without a shell, host env, writable root or network", () => {
    const args = runArgs("test", DIGEST, ["php", "tests/smoke.php"]);
    expect(args).toContain("--read-only");
    expect(args).toContain("--pids-limit");
    expect(args.slice(args.indexOf("--network"), args.indexOf("--network") + 2)).toEqual(["--network", "none"]);
    expect(args).not.toContain("--env");
    expect(args.slice(-4)).toEqual(["--entrypoint", "php", DIGEST, "tests/smoke.php"]);
    expect(() => runArgs("test", "php:latest", ["php", "-v"])).toThrow("immutable");
  });
});
