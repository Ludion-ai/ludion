import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compare, parseReleases, phpImage, replaceImage, scanPhp } from "../src/security/php.ts";
import { DEFAULT_CONFIG, readConfig, snapshot } from "../src/security/project.ts";
import { patchProject, type Command } from "../src/security/patch.ts";
import { runArgs } from "../../sandbox/src/docker.ts";
import { phpFixPublished } from "../src/security/exposure.ts";
import { commit, git } from "./git.ts";
import { withHub } from "./hub.ts";

const SOURCE = "FROM php:8.4.25-cli-alpine\nWORKDIR /app\nCOPY . .\n";
const releases = {
  "8.4.28": { date: "29 Oct 2026", tags: [] },
  "8.4.27": { date: "21 Oct 2026", tags: ["security"] },
  "8.4.25": { date: "27 Aug 2026", tags: [] },
  "8.5.12": { date: "21 Oct 2026", tags: ["security"] },
};
// php.net and Docker Hub are stand-ins (hub.ts); nothing is fetched.
const fetchFn: typeof fetch = withHub(async () => new Response(JSON.stringify(releases)));
// The clock, for the 72-hour wait of a move with no newer security release
// (docs/decisions/2026-10-31-limgv-image-newest-built-release.md, item 6): after every wait here, unless a test sets it.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z")); });
afterEach(() => { vi.useRealTimers(); });
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

// docs/decisions/2026-10-31-limgv-image-newest-built-release.md: when the Dockerfile's version is older than the newest
// release of its branch, the image moves to that release, marked security or not, once Docker Hub has its tag in the
// Dockerfile's variant, since Docker's official images rebuild only the newest tag of a line.
describe("official PHP image decisions: the newest release of the branch that Docker still builds", () => {
  it("keeps the branch and flavor, choosing the branch's newest release, 8.4.28, though only 8.4.27 is tagged security", async () => {
    const asked: string[] = [];
    const result = await scanPhp(SOURCE, withHub(async () => new Response(JSON.stringify(releases)), { asked }));
    expect(result.status).toBe("update_available");
    expect(result.candidate).toEqual({ version: "8.4.28", reference: "php:8.4.28-cli-alpine" });
    expect(result.security_releases.map(r => r.version)).toEqual(["8.4.27"]);
    // A security release lies between: no wait (decision B), and Docker Hub is asked for the tag, by name only.
    expect(result.wait_until).toBeUndefined();
    expect(asked).toEqual(["https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/php:pull", "HEAD https://registry-1.docker.io/v2/library/php/manifests/8.4.28-cli-alpine"]);
    expect(compare("8.4.9", "8.4.10")).toBeLessThan(0);
  });
  it("does not call no match secure, and does not move from the branch's newest release", async () => {
    const asked: string[] = [];
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.28"), withHub(async () => new Response(JSON.stringify(releases)), { asked }));
    expect(result.status).toBe("no_newer_security_release");
    expect(result.candidate).toBeNull();
    expect(result.note).toContain("not a security guarantee");
    expect(asked).toEqual([]);
  });
  // A sample shaped like php.net's JSON (made up, not fetched), newest first: 8.4.28 and 8.4.26 tagged security, and
  // 8.4.30 (30 Oct 2026), 8.4.29, 8.4.27 and 8.4.25 not. Only the branch's newest tag, 8.4.30, is still rebuilt.
  const sample = readFileSync(new URL("./fixtures/php-releases-8.4.json", import.meta.url), "utf8");
  const sampleFetch: typeof fetch = withHub(async () => new Response(sample));
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
    expect(result.wait_until).toBeUndefined();
    // The exposure-time start stays the first newer security release's day.
    expect(phpFixPublished(result).at).toBe(fixes.at(-1) === "8.4.26" ? "2026-09-11T00:00:00.000Z" : "2026-10-09T00:00:00.000Z");
  });
  it.each(["8.4.28", "8.4.29"])("from php:%s, no longer the branch's newest release, moves to 8.4.30 with no newer security release, outside exposure time", async from => {
    const result = await scanPhp(SOURCE.replace("8.4.25", from), sampleFetch);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.30", reference: "php:8.4.30-cli-alpine" }, security_releases: [], wait_until: "2026-11-03T00:00:00.000Z" });
    expect(phpFixPublished(result)).toEqual({ at: null, note: "Not counted: no newer PHP security release; a move to the line's newest release has no advisory, so it is outside exposure time." });
  });
  it("from php:8.4.30, the branch's newest release, finds no candidate", async () => {
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.30"), sampleFetch);
    expect(result).toMatchObject({ status: "no_newer_security_release", candidate: null, security_releases: [] });
  });
  // The 72-hour wait of a move with no newer security release: from the end of 8.4.30's day (30 Oct 2026), so until
  // 2026-11-03T00:00Z. Docker Hub is not asked while the move waits.
  it.each([
    ["2026-10-30T12:00:00.000Z", "wait"], ["2026-11-02T12:00:00.000Z", "wait"], ["2026-11-02T23:59:59.999Z", "wait"],
    ["2026-11-03T00:00:00.000Z", "update_available"],
  ])("from php:8.4.29 at %s, the move to 8.4.30 is %s", async (now, status) => {
    vi.setSystemTime(new Date(now));
    const asked: string[] = [];
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.29"), withHub(async () => new Response(sample), { asked }));
    expect(result).toMatchObject({ status, candidate: { version: "8.4.30" }, security_releases: [], wait_until: "2026-11-03T00:00:00.000Z" });
    expect(asked.length).toBe(status === "wait" ? 0 : 2);
  });
  it("does not wait when a security release lies between, on 8.4.30's own day", async () => {
    vi.setSystemTime(new Date("2026-10-30T01:00:00.000Z"));
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.27"), sampleFetch);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.30" } });
    expect(result.security_releases.map(r => r.version)).toEqual(["8.4.28"]);
    expect(result.wait_until).toBeUndefined();
  });
  it("stops when the newest release's day cannot be read, so its wait cannot be counted", async () => {
    const lookup = withHub(async () => new Response(JSON.stringify({ "8.4.30": { tags: [], date: "2026-10-30" }, "8.4.29": { tags: [], date: "23 Oct 2026" } })));
    await expect(scanPhp(SOURCE.replace("8.4.25", "8.4.29"), lookup)).rejects.toThrow("The official day of PHP 8.4.30 is not in the form Ludion reads, so its 72-hour wait cannot be counted. No update decision was made.");
  });
  // The tag must exist on Docker Hub in the Dockerfile's variant (item 4): Docker may not have published it yet, or may no
  // longer build the variant. Either way the scan stops and says why; it never reports update_available.
  it.each([["8.4.25", "with a security release between"], ["8.4.29", "with none"]])("stops when Docker Hub has no tag for the move from php:%s (%s)", async from => {
    const asked: string[] = [];
    const lookup = withHub(async () => new Response(sample), { missing: ["8.4.30-cli-alpine"], asked });
    await expect(scanPhp(SOURCE.replace("8.4.25", from), lookup)).rejects.toThrow("Docker Hub has no php:8.4.30-cli-alpine, the newest release of PHP 8.4 in the Dockerfile's variant: Docker has not published it yet, or no longer builds this variant. Ludion does not move the variant or its OS release. No update decision was made.");
    expect(asked.at(-1)).toBe("HEAD https://registry-1.docker.io/v2/library/php/manifests/8.4.30-cli-alpine");
    // Another variant's tag is there; it is not taken.
    await expect(scanPhp(SOURCE.replace("8.4.25-cli-alpine", `${from}-fpm`), lookup)).resolves.toMatchObject({ status: "update_available", candidate: { reference: "php:8.4.30-fpm" } });
  });
  it("stops when Docker Hub cannot be read", async () => {
    const down: typeof fetch = async url => String(url).startsWith("https://registry-1.docker.io/") ? new Response(null, { status: 503 }) : withHub(async () => new Response(sample))(url);
    await expect(scanPhp(SOURCE, down)).rejects.toThrow("Docker Hub gave no digest for php:8.4.30-cli-alpine (HTTP 503).");
    const noToken: typeof fetch = async url => new Response(String(url).startsWith("https://auth.docker.io/") ? "{}" : sample);
    await expect(scanPhp(SOURCE, noToken)).rejects.toThrow("Docker Hub gave no pull token.");
  });
  // The day the tag stops being the newest: the sample as php.net would have listed it up to a day. php:8.4.28, the newest
  // release and tagged security, stays while it is the newest, and moves once 8.4.29, not tagged security, is listed.
  const upTo = (last: string): typeof fetch => withHub(async () => new Response(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(sample)).filter(([v]) => compare(v, last) <= 0)))));
  it("moves once a later release makes the tag no longer the branch's newest", async () => {
    const from = SOURCE.replace("8.4.25", "8.4.28");
    expect(await scanPhp(from, upTo("8.4.28"))).toMatchObject({ status: "no_newer_security_release", candidate: null });
    expect(await scanPhp(from, upTo("8.4.29"))).toMatchObject({ status: "update_available", candidate: { version: "8.4.29", reference: "php:8.4.29-cli-alpine" }, security_releases: [], wait_until: "2026-10-27T00:00:00.000Z" });
  });
  // A list with no release as new as the Dockerfile's is missing releases: whether the tag is the newest cannot be read.
  it.each([["8.4.31", sampleFetch], ["8.4.29", upTo("8.4.28")], ["8.4.100", sampleFetch]] as const)("stops when php.net's list has no release as new as php:%s", async (from, lookup) => {
    await expect(scanPhp(SOURCE.replace("8.4.25", from), lookup)).rejects.toThrow(`The official PHP 8.4 release list has no release as new as ${from}; it is missing releases. No update decision was made.`);
  });
  // R237's R5: the same made-up sample with its entries oldest first, as php.net's JSON is not promised to be in order. The
  // choice must not come from the response's order, which would give its last entry, 8.4.25.
  const reversedFetch: typeof fetch = withHub(async () => new Response(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(sample)).reverse()))));
  it("takes the same newest release when php.net lists its releases oldest first (R237's R5)", async () => {
    const result = await scanPhp(SOURCE.replace("8.4.25", "8.4.24"), reversedFetch);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "8.4.30", reference: "php:8.4.30-cli-alpine" } });
    expect(result.security_releases.map(r => r.version)).toEqual(["8.4.28", "8.4.26"]);
    expect(await scanPhp(SOURCE.replace("8.4.25", "8.4.30"), reversedFetch)).toMatchObject({ status: "no_newer_security_release", candidate: null });
  });
  // R237's R10, made up: from 8.4.9, the releases 8.4.10 and 8.4.11 are newer by number though "8.4.10" < "8.4.9" as text,
  // so the scan must find them, and neither report the silent "no update" nor stop.
  it.each([
    [{ "8.4.11": { tags: [], date: "06 Nov 2026" }, "8.4.10": { tags: ["security"], date: "23 Oct 2026" }, "8.4.9": { tags: [], date: "09 Oct 2026" } }, "8.4.11", ["8.4.10"]],
    [{ "8.4.10": { tags: [], date: "23 Oct 2026" }, "8.4.9": { tags: [], date: "09 Oct 2026" } }, "8.4.10", []],
  ])("compares versions by number in the scan, across a digit boundary (R237's R10, %#)", async (list, to, fixes) => {
    const result = await scanPhp("FROM php:8.4.9-cli\n", withHub(async () => new Response(JSON.stringify(list))));
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
  // docs/decisions/2026-10-31-limgv-image-newest-built-release.md, items 6 to 8: php:8.4.27 is no longer the branch's
  // newest release (8.4.28, 29 Oct 2026, not tagged security), so it moves after the wait, with a commit that says the fact.
  it("moves php:8.4.27, no longer the branch's newest release, to 8.4.28 after its wait, and says only the fact", async () => {
    const root = fixture();
    writeFileSync(join(root, "Dockerfile"), SOURCE.replace("8.4.25", "8.4.27"));
    commit(root);
    const result = await patchProject(root, true, { fetchFn, command, testRun });
    expect(result.receipt).toMatchObject({ outcome: "applied", branch: "ludion/php/8.4.28", fix_published_at: null, scan: { security_releases: [], wait_until: "2026-11-02T00:00:00.000Z" } });
    expect(result.receipt?.fix_published_note).toBe("Not counted: no newer PHP security release; a move to the line's newest release has no advisory, so it is outside exposure time.");
    expect(git(root, "show", "ludion/php/8.4.28:Dockerfile") + "\n").toBe(SOURCE.replace("php:8.4.25-cli-alpine", `php:8.4.28-cli-alpine@${DIGEST}`));
    expect(git(root, "log", "-1", "--format=%B", "ludion/php/8.4.28")).toContain("ludion: PHP 8.4.27 -> 8.4.28 in Dockerfile\n\nPHP 8.4.28, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line.\n\nLudion receipt ");
  });
  it("runs no Docker work and writes no receipt while that move waits", async () => {
    vi.setSystemTime(new Date("2026-11-01T23:59:59.999Z"));
    const root = fixture();
    writeFileSync(join(root, "Dockerfile"), SOURCE.replace("8.4.25", "8.4.27"));
    commit(root);
    let docker = 0;
    const result = await patchProject(root, true, { fetchFn, command: async (args, timeout) => { docker++; return command(args, timeout); }, testRun });
    expect(result).toMatchObject({ receipt: null, path: null, scan: { status: "wait", candidate: { version: "8.4.28" }, wait_until: "2026-11-02T00:00:00.000Z" } });
    expect(docker).toBe(0);
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
  });
  it("stops before Docker when Docker Hub has no tag for the move, and leaves no branch or lock", async () => {
    const root = fixture();
    let docker = 0;
    await expect(patchProject(root, true, { fetchFn: withHub(async () => new Response(JSON.stringify(releases)), { missing: ["8.4.28-cli-alpine"] }), command: async (args, timeout) => { docker++; return command(args, timeout); }, testRun })).rejects.toThrow("Docker Hub has no php:8.4.28-cli-alpine");
    expect(docker).toBe(0);
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
    expect(existsSync(join(root, ".ludion/security/patch.lock"))).toBe(false);
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
    expect(phpFixPublished({ ...scan, candidate: null, security_releases: [] }).note).toContain("Not found");
    // A move with no newer security release is not counted at all (it has no advisory), whatever its dates.
    expect(phpFixPublished({ ...scan, security_releases: [] })).toMatchObject({ at: null, note: expect.stringContaining("Not counted") });
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
      fetchFn: withHub(async () => { writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ ...DEFAULT_CONFIG, test: ["php", "different.php"] })); return new Response(JSON.stringify(releases)); }),
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
