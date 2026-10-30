// The official Node.js image, moved to a security release of its own line (packages/cli/src/security/node.ts;
// docs/decisions/2026-10-31-lnode-node-image.md). nodejs.org's index and Docker are stand-ins here; nothing is fetched or run.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { NODE_INDEX_URL, nodeImage, parseNodeReleases, scanNode } from "../src/security/node.ts";
import { nodeFixPublished } from "../src/security/exposure.ts";
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
const fetchFn: typeof fetch = async url => { asked.push(String(url)); return new Response(JSON.stringify(INDEX)); };
const DIGEST = `sha256:${"b".repeat(64)}`;
const command: Command = async args => args.includes("{{.Id}}") ? DIGEST : args[0] === "image" && args[1] === "inspect" ? JSON.stringify([`node@${DIGEST}`]) : "";
function fixture(dockerfile = SOURCE): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-node-test-"));
  writeFileSync(join(root, "Dockerfile"), dockerfile);
  writeFileSync(join(root, "ludion.security.json"), JSON.stringify(DEFAULT_NODE_CONFIG));
  commit(root);
  return root;
}

describe("official Node.js security update decisions", () => {
  it("takes the newest security release of the same major, keeping the variant, and never a later release not marked security", async () => {
    asked.length = 0;
    const result = await scanNode(SOURCE, fetchFn);
    expect(asked).toEqual([NODE_INDEX_URL]);
    expect(result).toMatchObject({ status: "update_available", runtime: "node", scope: "dockerfile_base_image", source: "https://nodejs.org/dist/index.json" });
    expect(result.current).toMatchObject({ version: "22.11.0", branch: "22", flavor: "-alpine" });
    expect(result.candidate).toEqual({ version: "22.23.4", reference: "node:22.23.4-alpine" });
    expect(result.security_releases.map(r => r.version)).toEqual(["22.23.4", "22.23.2"]);
  });
  it("reads an image with no variant, or pinned, and says no newer security release without calling that secure", async () => {
    expect((await scanNode(`FROM docker.io/library/node:22.23.2@${DIGEST}\n`, fetchFn)).candidate).toEqual({ version: "22.23.4", reference: "node:22.23.4" });
    const none = await scanNode("FROM node:22.23.4-bookworm-slim\n", fetchFn);
    expect(none).toMatchObject({ status: "no_newer_security_release", candidate: null, security_releases: [] });
    expect(none.note).toContain("not a security guarantee");
    // A line with no security release newer than the image, and none at all.
    expect((await scanNode("FROM node:24.22.1-alpine\n", fetchFn)).candidate).toBeNull();
    await expect(scanNode("FROM node:20.1.0-alpine\n", fetchFn)).rejects.toThrow("No official releases found for Node.js 20");
  });
  it.each([
    "FROM node:22\n", "FROM node:lts-alpine\n", "FROM node:22-alpine\n", "FROM node:22.11-alpine\n", "FROM node:v22.11.0\n", "FROM node:22.11.0-Alpine\n",
    "FROM evil/node:22.11.0\n", "FROM ghcr.io/library/node:22.11.0\n", "ARG V=22.11.0\nFROM node:${V}\n", "FROM node:22.11.0 AS build\n",
    "FROM node:22.11.0\nFROM scratch\n", "# syntax=evil/build\nFROM node:22.11.0\n", "FROM node:22.11.0\nADD https://example.com/app /app\n",
    "FROM node:22.11.0\nCOPY --from=evil / /app\n", "FROM node:22.11.0\nRUN --network=host true\n", `FROM node:22.11.0-${"a".repeat(65)}\n`,
  ])("refuses an image or build input it cannot read exactly: %s", text => {
    expect(() => nodeImage(text)).toThrow();
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
    expect(nodeFixPublished({ ...scan, security_releases: [] }).note).toContain("Not found");
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
      await expect(securityCli("init", ["--dir", both])).rejects.toThrow("--ecosystem php|node|npm|composer|maven");
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
      expect(await scanProject(root, "node")).toMatchObject({ checks: [{ ecosystem: "node", result: { candidate: { version: "22.23.4" } } }] });
      // A floating tag is shown as a check that failed, not left out.
      writeFileSync(join(root, "Dockerfile"), "FROM node:22-alpine\n");
      expect((await scanProject(root)).checks).toMatchObject([{ ecosystem: "node", error: expect.stringContaining("exact version") }]);
      writeFileSync(join(root, "Dockerfile"), "FROM php:8.4.26-cli-alpine\nCOPY --chown=node:node . .\n");
      expect((await scanProject(root, undefined)).checks.map(c => c.ecosystem)).toEqual(["php"]);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("Node.js image patch, validated and applied as PHP's", () => {
  it("pins the official node image by digest, probes the built image's node version, and commits only FROM on ludion/node/<version>", async () => {
    for (const apply of [false, true]) {
      const root = fixture(), head = git(root, "rev-parse", "HEAD"), before = snapshot(root), calls: string[][] = [], runs: string[][] = [];
      const result = await patchProject(root, apply, { fetchFn, command: async (args, timeout) => { calls.push(args); return command(args, timeout); }, testRun: async (_name, _image, argv) => { runs.push([...argv]); } });
      expect(result.receipt).toMatchObject({ outcome: apply ? "applied" : "validated", baseline_passed: true, candidate_passed: true, scope: "dockerfile_only_not_deployed", scan: { runtime: "node" } });
      expect(calls.filter(a => a[0] === "pull").map(a => a[1])).toEqual(["node:22.11.0-alpine", "node:22.23.4-alpine"]);
      expect(calls.filter(a => a[0] === "build").every(a => a.includes("--network=none"))).toBe(true);
      expect(result.receipt).toMatchObject({ old_digest: `node@${DIGEST}`, new_digest: `node@${DIGEST}` });
      // The version probe of each built image, then the project's own test.
      expect(runs).toEqual([
        ["node", "-e", "process.exit(process.version === 'v22.11.0' ? 0 : 1)"], ["node", "tests/smoke.js"],
        ["node", "-e", "process.exit(process.version === 'v22.23.4' ? 0 : 1)"], ["node", "tests/smoke.js"],
      ]);
      expect(result.receipt).toMatchObject({ fix_published_at: "2026-07-28T00:00:00.000Z", found_at: result.scan.checked_at });
      expect(readFileSync(join(root, "Dockerfile"), "utf8")).toBe(SOURCE);
      expect(snapshot(root)).toBe(before);
      if (apply) {
        expect(result.receipt).toMatchObject({ base_commit: head, branch: "ludion/node/22.23.4", commit: git(root, "rev-parse", "ludion/node/22.23.4") });
        expect(git(root, "show", "ludion/node/22.23.4:Dockerfile") + "\n").toBe(SOURCE.replace("node:22.11.0-alpine", `node:22.23.4-alpine@${DIGEST}`));
        expect(git(root, "rev-parse", "ludion/node/22.23.4^")).toBe(head);
        expect(git(root, "log", "-1", "--format=%B", "ludion/node/22.23.4")).toContain("ludion: Node.js 22.11.0 -> 22.23.4 in Dockerfile\n\nOfficial Node.js security releases: 22.23.4, 22.23.2.");
      }
    }
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
  it("runs no Docker work when nodejs.org has no newer security release for the line", async () => {
    const root = fixture("FROM node:22.23.4-alpine\n");
    let docker = 0;
    const result = await patchProject(root, true, { fetchFn, command: async (args, timeout) => { docker++; return command(args, timeout); }, testRun: async () => {} });
    expect(result).toMatchObject({ receipt: null, path: null, scan: { status: "no_newer_security_release" } });
    expect(docker).toBe(0);
  });
});
