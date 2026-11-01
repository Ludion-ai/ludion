// The official Node.js image, moved to the newest release of its line that Docker still builds in its variant
// (packages/cli/src/security/node.ts; docs/decisions/2026-10-31-lnode-node-image.md, whose item 5 is replaced by
// docs/decisions/2026-10-31-limgv-image-newest-built-release.md). nodejs.org's index, Docker Hub and Docker are stand-ins
// here; nothing is fetched or run.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_INDEX_URL, nodeImage, parseNodeReleases, scanNode } from "../src/security/node.ts";
import { nodeFixPublished } from "../src/security/exposure.ts";
import { compare, ImageMoveStopped, MissingImageTag } from "../src/security/php.ts";
import { withHub } from "./hub.ts";
import { DEFAULT_NODE_CONFIG, readConfig, snapshot } from "../src/security/project.ts";
import { patchProject, type Command } from "../src/security/patch.ts";
import { scanProject } from "../src/security/scan.ts";
import { securityCli } from "../src/security/cli.ts";
import { commit, git } from "./git.ts";

const SOURCE = "FROM node:22.11.0-alpine\nWORKDIR /app\nCOPY --chown=node:node . .\n";
const entry = (version: string, date: string, security: boolean, extra: Record<string, unknown> = {}) => ({ version, date, files: ["linux-x64"], npm: "10.9.0", lts: "Jod", security, ...extra });
// Newest first, as nodejs.org lists it: another line, a prerelease, a later release not marked security, two security releases.
const INDEX = [
  entry("v27.0.0-alpha.0.0.0", "2026-10-29", false),
  entry("v24.22.1", "2026-10-20", true),
  entry("v22.23.5", "2026-10-27", false),
  entry("v22.23.4", "2026-10-20", true),
  entry("v22.23.3", "2026-09-01", false),
  entry("v22.23.2", "2026-07-28", true),
  entry("v22.11.0", "2024-10-29", false),
  entry("v22.10.0", "2024-10-16", true),
];
const asked: string[] = [];
// `asked` records nodejs.org's requests; Docker Hub's (hub.ts) are answered in front of it.
const fetchFn: typeof fetch = withHub(async url => { asked.push(String(url)); return new Response(JSON.stringify(INDEX)); });
// The clock, for the 72-hour wait of a move with no newer security release: after every wait here, unless a test sets it.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z")); });
afterEach(() => { vi.useRealTimers(); });
const DIGEST = `sha256:${"b".repeat(64)}`;
const command: Command = async args => args.includes("{{.Id}}") ? DIGEST : args[0] === "image" && args[1] === "inspect" ? JSON.stringify([`node@${DIGEST}`]) : "";
function fixture(dockerfile = SOURCE): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-node-test-"));
  writeFileSync(join(root, "Dockerfile"), dockerfile);
  writeFileSync(join(root, "ludion.security.json"), JSON.stringify(DEFAULT_NODE_CONFIG));
  commit(root);
  return root;
}

describe("official Node.js image decisions: the newest release of the line that Docker still builds", () => {
  it("takes the newest release of the same major, keeping the variant, though it is not marked security", async () => {
    asked.length = 0;
    const hub: string[] = [];
    const result = await scanNode(SOURCE, withHub(fetchFn, { asked: hub }));
    expect(asked).toEqual([NODE_INDEX_URL]);
    expect(hub).toEqual(["https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull", "HEAD https://registry-1.docker.io/v2/library/node/manifests/22.23.5-alpine"]);
    expect(result).toMatchObject({ status: "update_available", runtime: "node", scope: "dockerfile_base_image", source: "https://nodejs.org/dist/index.json" });
    expect(result.current).toMatchObject({ version: "22.11.0", branch: "22", flavor: "-alpine" });
    expect(result.candidate).toEqual({ version: "22.23.5", reference: "node:22.23.5-alpine" });
    expect(result.security_releases.map(r => r.version)).toEqual(["22.23.4", "22.23.2"]);
    expect(result.wait_until).toBeUndefined();
  });
  it("reads an image with no variant, or pinned, and says no newer security release without calling that secure", async () => {
    expect((await scanNode(`FROM docker.io/library/node:22.23.2@${DIGEST}\n`, fetchFn)).candidate).toEqual({ version: "22.23.5", reference: "node:22.23.5" });
    const none = await scanNode("FROM node:22.23.5-bookworm-slim\n", fetchFn);
    expect(none).toMatchObject({ status: "no_newer_security_release", candidate: null, security_releases: [] });
    expect(none.note).toContain("not a security guarantee");
    // The line's newest release is a security release, and a line with none at all.
    expect((await scanNode("FROM node:24.22.1-alpine\n", fetchFn)).candidate).toBeNull();
    await expect(scanNode("FROM node:20.1.0-alpine\n", fetchFn)).rejects.toThrow("No official releases found for Node.js 20");
  });
  it("moves node:22.23.4, a security release no longer the line's newest, to 22.23.5 with no newer security release, outside exposure time", async () => {
    const result = await scanNode("FROM node:22.23.4-alpine\n", fetchFn);
    expect(result).toMatchObject({ status: "update_available", candidate: { version: "22.23.5", reference: "node:22.23.5-alpine" }, security_releases: [], wait_until: "2026-10-31T00:00:00.000Z" });
    expect(nodeFixPublished(result)).toEqual({ at: null, note: "Not counted: no newer Node.js security release; a move to the line's newest release has no advisory, so it is outside exposure time." });
  });
  // 22.23.5 is dated 2026-10-27, so the move waits until the end of that day plus 72 hours.
  it.each([["2026-10-30T23:59:59.999Z", "wait"], ["2026-10-31T00:00:00.000Z", "update_available"]])("from node:22.23.4 at %s, the move to 22.23.5 is %s", async (now, status) => {
    vi.setSystemTime(new Date(now));
    const hub: string[] = [];
    expect(await scanNode("FROM node:22.23.4-alpine\n", withHub(fetchFn, { asked: hub }))).toMatchObject({ status, candidate: { version: "22.23.5" }, wait_until: "2026-10-31T00:00:00.000Z" });
    expect(hub.length).toBe(status === "wait" ? 0 : 2);
  });
  it("moves once a later release makes the tag no longer the line's newest", async () => {
    const upTo = (last: string): typeof fetch => withHub(async () => new Response(JSON.stringify(INDEX.filter(e => e.version.startsWith("v24.") || e.version.includes("-") || compare(e.version.slice(1), last) <= 0))));
    expect(await scanNode("FROM node:22.23.4-alpine\n", upTo("22.23.4"))).toMatchObject({ status: "no_newer_security_release", candidate: null });
    expect(await scanNode("FROM node:22.23.4-alpine\n", upTo("22.23.5"))).toMatchObject({ status: "update_available", candidate: { version: "22.23.5" }, security_releases: [] });
  });
  it.each(["22.23.6", "22.100.0", "24.22.2"])("stops when nodejs.org's index has no release of the line as new as node:%s", async version => {
    await expect(scanNode(`FROM node:${version}-alpine\n`, fetchFn)).rejects.toThrow(`The official Node.js ${version.split(".")[0]} release list has no release as new as ${version}; it is missing releases. No update decision was made.`);
  });
  it("takes the same newest release when the index lists its releases oldest first", async () => {
    const result = await scanNode(SOURCE, withHub(async () => new Response(JSON.stringify([...INDEX].reverse()))));
    expect(result).toMatchObject({ candidate: { version: "22.23.5" } });
    expect(result.security_releases.map(r => r.version)).toEqual(["22.23.4", "22.23.2"]);
  });
  it.each([["FROM node:22.11.0-alpine\n", "22.23.5-alpine"], ["FROM node:22.23.4\n", "22.23.5"]])("stops when Docker Hub has no tag for the move: %s", async (text, tag) => {
    await expect(scanNode(text, withHub(fetchFn, { missing: [tag] }))).rejects.toThrow(`Docker Hub has no node:${tag}, the newest release of Node.js 22 in the Dockerfile's variant: Docker has not published it yet, or no longer builds this variant. Ludion does not move the variant or its OS release. No update decision was made.`);
  });
  // The stop keeps the newer security releases, so a scan still reports them (scan.ts); with none, the reason is as before.
  it.each([
    ["FROM node:22.11.0-alpine\n", "22.23.5-alpine", "Node.js 22.23.4 and 22.23.2 are security releases newer than 22.11.0; ", ["22.23.4", "22.23.2"]],
    ["FROM node:22.23.2-alpine\n", "22.23.5-alpine", "Node.js 22.23.4 is a security release newer than 22.23.2; ", ["22.23.4"]],
    ["FROM node:22.23.4\n", "22.23.5", "", []],
  ])("names the newer security releases when Docker Hub has no tag for the move: %s", async (text, tag, named, versions) => {
    const stop = await scanNode(text, withHub(fetchFn, { missing: [tag] })).then(() => undefined, (error: unknown) => error);
    expect(stop).toBeInstanceOf(MissingImageTag);
    expect((stop as MissingImageTag).message).toBe(`${named}Docker Hub has no node:${tag}, the newest release of Node.js 22 in the Dockerfile's variant: Docker has not published it yet, or no longer builds this variant. Ludion does not move the variant or its OS release. No update decision was made.`);
    expect((stop as MissingImageTag).security_releases.map(r => r.version)).toEqual(versions);
  });
  // Docker Hub failing other than with a 404 keeps the newer security releases too; with none, its error is as before.
  const down: typeof fetch = async (input, init) => String(input).startsWith("https://registry-1.docker.io/") ? new Response(null, { status: 503 }) : fetchFn(input, init);
  it("keeps the newer security releases when Docker Hub cannot be read", async () => {
    const stop = await scanNode("FROM node:22.11.0-alpine\n", down).then(() => undefined, (error: unknown) => error);
    expect(stop).toBeInstanceOf(ImageMoveStopped);
    expect(stop).not.toBeInstanceOf(MissingImageTag);
    expect((stop as ImageMoveStopped).message).toBe("Node.js 22.23.4 and 22.23.2 are security releases newer than 22.11.0; Docker Hub could not be checked for node:22.23.5-alpine, the newest release of Node.js 22 in the Dockerfile's variant: Docker Hub gave no digest for node:22.23.5-alpine (HTTP 503). Ludion does not move the image without that check. No update decision was made.");
    expect((stop as ImageMoveStopped).security_releases.map(r => r.version)).toEqual(["22.23.4", "22.23.2"]);
  });
  it("throws Docker Hub's error as before when no newer security release lies between", async () => {
    const stop = await scanNode("FROM node:22.23.4\n", down).then(() => undefined, (error: unknown) => error);
    expect(stop).toBeInstanceOf(Error);
    expect(stop).not.toBeInstanceOf(ImageMoveStopped);
    expect((stop as Error).message).toBe("Docker Hub gave no digest for node:22.23.5 (HTTP 503).");
  });
  it.each([
    "FROM node:22\n", "FROM node:lts-alpine\n", "FROM node:22-alpine\n", "FROM node:22.11-alpine\n", "FROM node:v22.11.0\n", "FROM node:22.11.0-Alpine\n",
    "FROM evil/node:22.11.0\n", "FROM ghcr.io/library/node:22.11.0\n", "ARG V=22.11.0\nFROM node:${V}\n", "FROM node:22.11.0 AS build\n",
    "FROM node:22.11.0\nFROM scratch\n", "# syntax=evil/build\nFROM node:22.11.0\n", "FROM node:22.11.0\nADD https://example.com/app /app\n",
    "FROM node:22.11.0\nCOPY --from=evil / /app\n", "FROM node:22.11.0\nRUN --network=host true\n", `FROM node:22.11.0-${"a".repeat(65)}\n`,
    // A pin that is not a sha256 digest of 64 lower-case hex digits (R231d's R2).
    `FROM node:22.11.0@sha256:${"a".repeat(63)}\n`, `FROM node:22.11.0@sha256:${"a".repeat(65)}\n`, `FROM node:22.11.0@sha256:${"A".repeat(64)}\n`,
    `FROM node:22.11.0@md5:${"a".repeat(32)}\n`, `FROM node:22.11.0-alpine@sha512:${"a".repeat(128)}\n`, `FROM node:22.11.0@${"a".repeat(64)}\n`,
  ])("refuses an image or build input it cannot read exactly: %s", text => {
    expect(() => nodeImage(text)).toThrow();
  });
  it("asks for the index with no redirect and a 30-second deadline", async () => {
    const seen: (RequestInit | undefined)[] = [], timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      await scanNode(SOURCE, withHub(async (_url, init) => { seen.push(init); return new Response(JSON.stringify(INDEX)); }));
      expect(seen).toMatchObject([{ redirect: "error" }]);
      expect(timeout).toHaveBeenCalledWith(30_000);
    } finally { timeout.mockRestore(); }
  });
  it("fails closed on an unavailable, oversized or incomplete index", async () => {
    await expect(scanNode(SOURCE, async () => new Response("", { status: 503 }))).rejects.toThrow("HTTP 503");
    await expect(scanNode(SOURCE, async () => new Response(" ".repeat(4 * 1024 * 1024 + 1)))).rejects.toThrow("4 MiB");
    expect(() => parseNodeReleases({ "v22.11.0": {} }, "22")).toThrow("Invalid official Node.js release index");
    expect(() => parseNodeReleases([null], "22")).toThrow("Invalid Node.js release entry");
    expect(() => parseNodeReleases([{ date: "2026-10-20" }], "22")).toThrow("Invalid Node.js release entry");
    for (const bad of [entry("v22.23.4", "2026-02-30", true), entry("v22.23.4", "20 Oct 2026", true), entry("v22.23.4", "2026-10-20", true, { security: "true" }),entry("v22.23.4", "2026-10-20", true, { security: undefined })]) {
      expect(() => parseNodeReleases([bad], "22")).toThrow("Incomplete Node.js release metadata");
    }
    expect(() => parseNodeReleases([entry("v22.23.4", "2026-10-20", true), entry("v22.23.4", "2026-10-20", false)], "22")).toThrow("listed twice");
    // An incomplete entry of another line does not stop this line's decision.
    expect(parseNodeReleases([entry("v24.1.0", "bad", true), entry("v22.23.4", "2026-10-20", true)], "22").map(r => r.version)).toEqual(["22.23.4"]);
  });
  it("records the first newer security release's day as the fix's publication, or null with the reason", async () => {
    const scan = await scanNode(SOURCE, fetchFn);
    expect(nodeFixPublished(scan)).toMatchObject({ at: "2026-07-28T00:00:00.000Z" });
    expect(nodeFixPublished({ ...scan, security_releases: [{ version: "22.23.2", date: "28 Jul 2026", security: true }] })).toMatchObject({ at: null });
    expect(nodeFixPublished({ ...scan, candidate: null, security_releases: [] }).note).toContain("Not found");
    expect(nodeFixPublished({ ...scan, security_releases: [] })).toMatchObject({ at: null, note: expect.stringContaining("Not counted") });
  });
});

describe("the Node.js image policy", () => {
  it("is a Dockerfile policy with ecosystem node; it takes no tool image", () => {
    const root = fixture();
    expect(readConfig(root)).toEqual(DEFAULT_NODE_CONFIG);
    writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ ...DEFAULT_NODE_CONFIG, image: "node:24-slim" }));
    expect(() => readConfig(root)).toThrow("Unknown options are refused");
    writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ schema: 1, ecosystem: "node", test: ["node", "t.js"], timeout_seconds: 30 }));
    expect(() => readConfig(root)).toThrow();
  });
  it("init offers node for a Dockerfile FROM node, and asks when an npm lockfile is there too", async () => {
    const root = mkdtempSync(join(tmpdir(), "ludion-node-init-"));
    writeFileSync(join(root, "Dockerfile"), SOURCE);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await securityCli("init", ["--dir", root])).toBe(0);
      expect(JSON.parse(readFileSync(join(root, "ludion.security.json"), "utf8"))).toEqual(DEFAULT_NODE_CONFIG);
      const both = mkdtempSync(join(tmpdir(), "ludion-node-init-"));
      writeFileSync(join(both, "Dockerfile"), SOURCE);
      writeFileSync(join(both, "package-lock.json"), JSON.stringify({ name: "a", lockfileVersion: 3, packages: { "": { name: "a" } } }));
      await expect(securityCli("init", ["--dir", both])).rejects.toThrow("--ecosystem php|node|npm|composer.");
      expect(await securityCli("init", ["--dir", both, "--ecosystem", "node"])).toBe(0);
      expect(JSON.parse(readFileSync(join(both, "ludion.security.json"), "utf8")).ecosystem).toBe("node");
    } finally { log.mockRestore(); }
  });
  it("scan checks the image when a FROM line names node, and not for node:node in a PHP Dockerfile", async () => {
    vi.stubGlobal("fetch", fetchFn);
    try {
      const root = mkdtempSync(join(tmpdir(), "ludion-node-scan-"));
      writeFileSync(join(root, "Dockerfile"), SOURCE);
      const found = await scanProject(root);
      expect(found.checks.map(c => c.ecosystem)).toEqual(["node"]);
      expect(found.status).toBe("attention_required");
      expect(await scanProject(root, "node")).toMatchObject({ checks: [{ ecosystem: "node", result: { candidate: { version: "22.23.5" } } }] });
      // A floating tag is shown as a check that failed, not left out.
      writeFileSync(join(root, "Dockerfile"), "FROM node:22-alpine\n");
      expect((await scanProject(root)).checks).toMatchObject([{ ecosystem: "node", error: expect.stringContaining("exact version") }]);
      writeFileSync(join(root, "Dockerfile"), "FROM php:8.4.26-cli-alpine\nCOPY --chown=node:node . .\n");
      expect((await scanProject(root, undefined)).checks.map(c => c.ecosystem)).toEqual(["php"]);
    } finally { vi.unstubAllGlobals(); }
  });
  /** An npm project with no dependencies: its check is clean and sends nothing. */
  const npmProject = (root: string) => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "a" }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ name: "a", lockfileVersion: 3, packages: { "": { name: "a" } } }));
  };
  // R231c's review (PR #231, comment 6534443349): these FROM lines name a node image in a form Ludion does not read, and
  // were left out of an unconfigured scan, which then exited 0 beside an npm lockfile.
  it.each([
    "FROM node:22-alpine\n", "\u{FEFF}FROM node:22-alpine\n", "FROM --platform=linux/amd64 node:22.11.0-alpine\n", "FROM --platform=$BUILDPLATFORM --pull node:22-alpine\n",
    "FROM docker.io/node:22.11.0-alpine\n", "FROM index.docker.io/library/node:22.11.0-alpine\n", "FROM ghcr.io/acme/node:22.11.0\n",
    `FROM node@sha256:${"c".repeat(64)}\n`, "FROM node\n", "FROM node AS build\n", "from Node:22-alpine\n",
  ])("scan reports a FROM naming node in a form it cannot read as a failed check, and exits 2: %s", async from => {
    vi.stubGlobal("fetch", async () => { throw new Error("no request expected"); });
    const error = vi.spyOn(console, "error").mockImplementation(() => {}), log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const lockfile of [false, true]) {
        const root = mkdtempSync(join(tmpdir(), "ludion-node-from-"));
        writeFileSync(join(root, "Dockerfile"), `${from}WORKDIR /app\n`);
        if (lockfile) npmProject(root);
        const scan = await scanProject(root);
        expect(scan.checks.map(c => `${c.ecosystem}:${"error" in c ? "error" : "ok"}`)).toEqual(lockfile ? ["npm:ok", "node:error"] : ["node:error"]);
        expect(scan.status).toBe("attention_required");
        expect(await securityCli("scan", ["--dir", root])).toBe(2);
      }
    } finally { vi.unstubAllGlobals(); error.mockRestore(); log.mockRestore(); }
  });
  it.each([
    "FROM php:8.4.26-cli-alpine\nCOPY --chown=node:node . .\n", "FROM --platform=linux/amd64 php:8.4.26-cli-alpine\nUSER node:node\n",
    "FROM nodejs:22\n", "FROM acme/node-app:1.0.0\n", "FROM php:8.4.26-cli-alpine AS node\n", "# FROM node:22\nFROM php:8.4.26-cli-alpine\n",
  ])("scan does not take a FROM that names no node image for one: %s", async text => {
    vi.stubGlobal("fetch", async () => { throw new Error("no request expected"); });
    try {
      const root = mkdtempSync(join(tmpdir(), "ludion-node-from-"));
      writeFileSync(join(root, "Dockerfile"), text);
      npmProject(root);
      const scan = await scanProject(root);
      expect(scan.checks.map(c => c.ecosystem)).not.toContain("node");
      // A PHP image, --platform included, is still PHP's check (here it fails, as fetch is refused).
      if (/\bphp:/.test(text)) expect(scan.checks.map(c => `${c.ecosystem}:${"error" in c ? "error" : "ok"}`)).toEqual(["npm:ok", "php:error"]);
    } finally { vi.unstubAllGlobals(); }
  });
  // R231d's review (PR #231, comment 6535222762): Docker builds a Dockerfile that starts with a UTF-8 byte-order mark, and
  // reads it without the mark. So does Ludion, for detection and for reading, PHP's included.
  it.each([
    ["FROM node:22.23.5\nWORKDIR /app\n", "node", { status: "no_newer_security_release", candidate: null }, 0],
    ["FROM node:22.11.0-alpine\nWORKDIR /app\n", "node", { status: "update_available", candidate: { version: "22.23.5", reference: "node:22.23.5-alpine" } }, 1],
    ["FROM php:8.4.27-fpm\nWORKDIR /app\n", "php", { status: "update_available", candidate: { version: "8.4.29", reference: "php:8.4.29-fpm" } }, 1],
  ] as const)("reads a Dockerfile with a byte-order mark as Docker does, as without one: %s", async (text, ecosystem, expected, exit) => {
    const php = { "8.4.29": { date: "30 Oct 2026", tags: [] }, "8.4.28": { date: "29 Oct 2026", tags: ["security"] }, "8.4.27": { date: "21 Oct 2026", tags: ["security"] } };
    vi.stubGlobal("fetch", withHub(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).startsWith("https://www.php.net/") ? php : INDEX))));
    const error = vi.spyOn(console, "error").mockImplementation(() => {}), log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const results = [];
      for (const mark of ["", "\u{FEFF}"]) {
        const root = mkdtempSync(join(tmpdir(), "ludion-node-bom-"));
        writeFileSync(join(root, "Dockerfile"), `${mark}${text}`);
        npmProject(root);
        const scan = await scanProject(root);
        expect(scan.checks.map(c => `${c.ecosystem}:${"error" in c ? "error" : "ok"}`)).toEqual(["npm:ok", `${ecosystem}:ok`]);
        const result = (scan.checks[1] as unknown as { result: { status: string; candidate: unknown; current: { start: number; end: number; reference: string; version: string; flavor: string } } }).result;
        expect(result).toMatchObject(expected);
        // The image's place in the file counts the mark; what is read does not.
        expect(text.slice(result.current.start - mark.length, result.current.end - mark.length)).toBe(result.current.reference);
        results.push({ ...result.current, start: result.current.start - mark.length, end: result.current.end - mark.length });
        expect(await securityCli("scan", ["--dir", root])).toBe(exit);
        // init sees the image too: beside the npm lockfile it asks which policy, and it writes the one asked for.
        await expect(securityCli("init", ["--dir", root])).rejects.toThrow("Choose the update policy with --ecosystem");
        expect(await securityCli("init", ["--dir", root, "--ecosystem", ecosystem])).toBe(0);
        expect(readConfig(root)).toMatchObject({ dockerfile: "Dockerfile", ...(ecosystem === "node" ? { ecosystem: "node" } : {}) });
      }
      expect(results[1]).toEqual(results[0]);
    } finally { vi.unstubAllGlobals(); error.mockRestore(); log.mockRestore(); }
  });
  it("scan checks the image of a saved node policy even when its FROM line names none (R231d's R5)", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("no request expected"); });
    try {
      const root = mkdtempSync(join(tmpdir(), "ludion-node-policy-"));
      writeFileSync(join(root, "Dockerfile"), "ARG IMG=node:22.11.0-alpine\nFROM ${IMG}\n");
      writeFileSync(join(root, "ludion.security.json"), JSON.stringify(DEFAULT_NODE_CONFIG));
      npmProject(root);
      const scan = await scanProject(root);
      expect(scan.checks).toMatchObject([{ ecosystem: "npm" }, { ecosystem: "node", error: expect.stringContaining("exact version") }]);
      expect(scan.status).toBe("attention_required");
      // Without the policy the line is not detected: it names no image.
      writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ schema: 1, ecosystem: "npm", test: ["npm", "test"], timeout_seconds: 30 }));
      expect((await scanProject(root)).checks.map(c => c.ecosystem)).toEqual(["npm"]);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("Node.js image patch, validated and applied as PHP's", () => {
  it("pins the official node image by digest, probes the built image's node version, and commits only FROM on ludion/node/<version>", async () => {
    for (const apply of [false, true]) {
      const root = fixture(), head = git(root, "rev-parse", "HEAD"), before = snapshot(root), calls: string[][] = [], runs: string[][] = [];
      const result = await patchProject(root, apply, { fetchFn, command: async (args, timeout) => { calls.push(args); return command(args, timeout); }, testRun: async (_name, _image, argv) => { runs.push([...argv]); } });
      expect(result.receipt).toMatchObject({ outcome: apply ? "applied" : "validated", baseline_passed: true, candidate_passed: true, scope: "dockerfile_only_not_deployed", scan: { runtime: "node" } });
      expect(calls.filter(a => a[0] === "pull").map(a => a[1])).toEqual(["node:22.11.0-alpine", "node:22.23.5-alpine"]);
      expect(calls.filter(a => a[0] === "build").every(a => a.includes("--network=none"))).toBe(true);
      expect(result.receipt).toMatchObject({ old_digest: `node@${DIGEST}`, new_digest: `node@${DIGEST}` });
      // The version probe of each built image, then the project's own test.
      expect(runs).toEqual([
        ["node", "-e", "process.exit(process.version === 'v22.11.0' ? 0 : 1)"], ["node", "tests/smoke.js"],
        ["node", "-e", "process.exit(process.version === 'v22.23.5' ? 0 : 1)"], ["node", "tests/smoke.js"],
      ]);
      expect(result.receipt).toMatchObject({ fix_published_at: "2026-07-28T00:00:00.000Z", found_at: result.scan.checked_at });
      expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
      expect(snapshot(root)).toBe(before);
      if (apply) {
        expect(result.receipt).toMatchObject({ base_commit: head, branch: "ludion/node/22.23.5", commit: git(root, "rev-parse", "ludion/node/22.23.5") });
        expect(git(root, "show", "ludion/node/22.23.5:Dockerfile") + "\n").toBe(SOURCE.replace("node:22.11.0-alpine", `node:22.23.5-alpine@${DIGEST}`));
        expect(git(root, "rev-parse", "ludion/node/22.23.5^")).toBe(head);
        expect(git(root, "log", "-1", "--format=%B", "ludion/node/22.23.5")).toContain("ludion: Node.js 22.11.0 -> 22.23.5 in Dockerfile\n\nOfficial Node.js security releases: 22.23.4, 22.23.2.");
      }
    }
  });
  it("updates a Dockerfile that starts with a byte-order mark, changing only FROM and keeping the mark", async () => {
    const root = fixture(`\u{FEFF}${SOURCE}`);
    const result = await patchProject(root, true, { fetchFn, command, testRun: async () => {} });
    expect(result.receipt).toMatchObject({ outcome: "applied", branch: "ludion/node/22.23.5" });
    // Read as bytes: the test's git helper trims its output, and trimming removes U+FEFF.
    const blob = spawnSync("git", ["cat-file", "blob", "ludion/node/22.23.5:Dockerfile"], { cwd: root }).stdout as Buffer;
    expect(blob.toString("utf8")).toBe(`\u{FEFF}${SOURCE.replace("node:22.11.0-alpine", `node:22.23.5-alpine@${DIGEST}`)}`);
    expect([...blob.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
  it("fails when the pulled image has no official node digest, and when a probe or test fails, and applies nothing", async () => {
    const root = fixture(), head = git(root, "rev-parse", "HEAD");
    const php: Command = async args => args.includes("{{.Id}}") ? DIGEST : args[0] === "image" && args[1] === "inspect" ? JSON.stringify([`php@${DIGEST}`]) : "";
    const result = await patchProject(root, true, { fetchFn, command: php, testRun: async () => {} });
    expect(result.receipt).toMatchObject({ outcome: "failed", reason: "Downloaded image has no official Node.js repository digest.", branch: null });
    let count = 0;
    const probe = await patchProject(root, true, { fetchFn, command, testRun: async () => { if (++count === 3) throw new Error("Validation exited 1"); } });
    expect(probe.receipt).toMatchObject({ outcome: "failed", candidate_passed: false });
    expect(git(root, "branch", "--list", "ludion/*")).toBe("");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });
  it("runs no Docker work when the image is its line's newest release", async () => {
    const root = fixture("FROM node:22.23.5-alpine\n");
    let docker = 0;
    const result = await patchProject(root, true, { fetchFn, command: async (args, timeout) => { docker++; return command(args, timeout); }, testRun: async () => {} });
    expect(result).toMatchObject({ receipt: null, path: null, scan: { status: "no_newer_security_release" } });
    expect(docker).toBe(0);
  });
  // docs/decisions/2026-10-31-limgv-image-newest-built-release.md, items 6 to 8.
  it("moves node:22.23.4 to 22.23.5, the line's newest release, after its wait, with a commit that says only the fact", async () => {
    const root = fixture("FROM node:22.23.4-alpine\n");
    const result = await patchProject(root, true, { fetchFn, command, testRun: async () => {} });
    expect(result.receipt).toMatchObject({ outcome: "applied", branch: "ludion/node/22.23.5", fix_published_at: null, scan: { runtime: "node", security_releases: [], wait_until: "2026-10-31T00:00:00.000Z" } });
    expect(git(root, "log", "-1", "--format=%B", "ludion/node/22.23.5")).toContain("ludion: Node.js 22.23.4 -> 22.23.5 in Dockerfile\n\nNode.js 22.23.5, the newest release of the line (no newer security release); Docker rebuilds only the newest tag of a line.\n\nLudion receipt ");
  });
});
