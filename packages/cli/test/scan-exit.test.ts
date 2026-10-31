// `ludion scan`'s exit code and text for an official image move (docs/decisions/2026-11-01-scan-exit-non-security-move.md):
// only a move with a newer security release between counts toward exit 1 and attention_required. A move to the line's
// newest release with none, waiting or not, is shown and does not change the exit code. php.net, nodejs.org and Docker
// Hub are stand-ins here; nothing is fetched or run.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanProject } from "../src/security/scan.ts";
import { securityCli } from "../src/security/cli.ts";
import { withHub } from "./hub.ts";

// PHP 8.4: 8.4.29 is a security release, 8.4.30 (30 Oct 2026) is not, so a move from 8.4.29 waits until 2026-11-03.
const PHP = { "8.4.30": { date: "30 Oct 2026", tags: [] }, "8.4.29": { date: "21 Oct 2026", tags: ["security"] }, "8.4.28": { date: "9 Oct 2026", tags: [] } };
const nodeEntry = (version: string, date: string, security: boolean) => ({ version, date, files: ["linux-x64"], npm: "10.9.0", lts: "Jod", security });
// Node.js 22: 22.23.4 is a security release, 22.23.5 (2026-10-27) is not, so a move from 22.23.4 waits until 2026-10-31.
const NODE = [nodeEntry("v22.23.5", "2026-10-27", false), nodeEntry("v22.23.4", "2026-10-20", true), nodeEntry("v22.23.3", "2026-09-01", false)];
const lists = async (url: string | URL | Request) => new Response(JSON.stringify(String(url).startsWith("https://www.php.net/") ? PHP : NODE));

const CASES = {
  php: { none: "FROM php:8.4.29-cli\nWORKDIR /app\n", between: "FROM php:8.4.28-cli\nWORKDIR /app\n", current: "8.4.29", before: "8.4.28", newest: "8.4.30", until: "2026-11-03T00:00:00.000Z", tag: "8.4.30-cli", label: "PHP", line: "PHP 8.4" },
  node: { none: "FROM node:22.23.4-alpine\nWORKDIR /app\n", between: "FROM node:22.23.3-alpine\nWORKDIR /app\n", current: "22.23.4", before: "22.23.3", newest: "22.23.5", until: "2026-10-31T00:00:00.000Z", tag: "22.23.5-alpine", label: "Node.js", line: "Node.js 22" },
} as const;

function project(dockerfile: string, extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-scan-exit-"));
  writeFileSync(join(root, "Dockerfile"), dockerfile);
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(root, name), text);
  return root;
}
/** The scan's exit code and what it printed, at `now`. Docker Hub answers 404 for the tags in `missing`; `args` are added. */
async function scan(root: string, now: string, missing: string[] = [], args: string[] = []): Promise<{ exit: number; out: string[]; err: string[] }> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal("fetch", withHub(lists, { missing }));
  const out: string[] = [], err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((line: unknown) => { out.push(String(line)); });
  const error = vi.spyOn(console, "error").mockImplementation((line: unknown) => { err.push(String(line)); });
  try { return { exit: await securityCli("scan", ["--dir", root, ...args]), out, err }; } finally { log.mockRestore(); error.mockRestore(); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const before = (iso: string) => new Date(Date.parse(iso) - 1).toISOString();

describe.each(Object.entries(CASES))("scan of the official %s image", (ecosystem, c) => {
  it("exits 0 for a move with no newer security release while it waits, and says so", async () => {
    const root = project(c.none);
    const { exit, out } = await scan(root, before(c.until));
    expect(exit).toBe(0);
    expect(out).toContain(`${ecosystem}: ${c.current} · newest release ${c.newest} of the line (no newer security release); waits until ${c.until}`);
    expect(out.join("\n")).not.toContain(`update ${c.newest}`);
    const report = await scanProject(root);
    expect(report.status).toBe("no_known_updates");
    // The move stays in the check's result.
    expect(report.checks).toMatchObject([{ ecosystem, result: { status: "wait", candidate: { version: c.newest }, security_releases: [], wait_until: c.until } }]);
  });
  it("exits 0 for the same move once its wait has ended, and says the wait ended", async () => {
    const root = project(c.none);
    const { exit, out } = await scan(root, c.until);
    expect(exit).toBe(0);
    expect(out).toContain(`${ecosystem}: ${c.current} · newest release ${c.newest} of the line (no newer security release); its wait ended ${c.until}`);
    const report = await scanProject(root);
    expect(report.status).toBe("no_known_updates");
    expect(report.checks).toMatchObject([{ ecosystem, result: { status: "update_available", candidate: { version: c.newest }, security_releases: [], wait_until: c.until } }]);
  });
  it.each([["during", true], ["after", false]] as const)("exits 1 for a move with a newer security release between, %s the other move's wait, as before", async (_when, waiting) => {
    const root = project(c.between);
    const { exit, out } = await scan(root, waiting ? before(c.until) : c.until);
    expect(exit).toBe(1);
    expect(out).toContain(`${ecosystem}: ${c.before} · update ${c.newest}`);
    const report = await scanProject(root);
    expect(report.status).toBe("attention_required");
    expect(report.checks).toMatchObject([{ ecosystem, result: { status: "update_available", candidate: { version: c.newest }, security_releases: [{ version: c.current }] } }]);
    expect((report.checks[0] as { result: { wait_until?: string } }).result.wait_until).toBeUndefined();
  });
  it("exits 0 when the Dockerfile is on the line's newest release", async () => {
    const root = project(c.none.replace(c.current, c.newest));
    const { exit, out } = await scan(root, c.until);
    expect(exit).toBe(0);
    expect(out).toContain(`${ecosystem}: ${c.newest} · no newer security release found`);
  });
  it.each([["waiting", true], ["after its wait", false]] as const)("still exits 2 beside an inventory that needs attention, the move %s", async (_when, waiting) => {
    const root = project(c.none, { "build.gradle": "" });
    const { exit, err } = await scan(root, waiting ? before(c.until) : c.until);
    expect(exit).toBe(2);
    expect(err.join("\n")).toContain("Unsupported inventories: build.gradle");
    expect((await scanProject(root)).status).toBe("attention_required");
  });
  it("exits 2 when the image check fails, as before", async () => {
    const root = project(c.none.replace(c.current, c.newest.replace(/\d+$/, "99")));
    const { exit, err } = await scan(root, c.until);
    expect(exit).toBe(2);
    expect(err.join("\n")).toContain("it is missing releases");
  });
  // Docker Hub has no tag for the line's newest release in the Dockerfile's variant (php.ts, imageMove): Docker has not
  // published it yet, or no longer builds the variant. No move is decided, but a newer security release is still found.
  const noTag = (c: (typeof CASES)[keyof typeof CASES], ecosystem: string) => `Docker Hub has no ${ecosystem}:${c.tag}, the newest release of ${c.line} in the Dockerfile's variant: Docker has not published it yet, or no longer builds this variant. Ludion does not move the variant or its OS release. No update decision was made.`;
  it.each([["during", true], ["after", false]] as const)("exits 1 when Docker Hub has no tag for the move but a newer security release lies between, %s the other move's wait, and names both", async (_when, waiting) => {
    const root = project(c.between);
    const at = waiting ? before(c.until) : c.until;
    const { exit, out, err } = await scan(root, at, [c.tag]);
    expect(exit).toBe(1);
    expect(out).toContain(`${ecosystem}: ${c.label} ${c.current} is a security release newer than ${c.before}; ${noTag(c, ecosystem)}`);
    expect(err.join("\n")).not.toContain("unavailable");
    const report = await scanProject(root);
    expect(report.status).toBe("attention_required");
    expect(report.checks).toEqual([{ ecosystem, error: `${c.label} ${c.current} is a security release newer than ${c.before}; ${noTag(c, ecosystem)}`, security_releases: [expect.objectContaining({ version: c.current, security: true })] }]);
    // scan --json shows the security release and the missing tag together.
    const json = await scan(root, at, [c.tag], ["--json"]);
    expect(json.exit).toBe(1);
    expect(JSON.parse(json.out.join("\n"))).toMatchObject({ status: "attention_required", checks: [{ ecosystem, error: expect.stringContaining(`Docker Hub has no ${ecosystem}:${c.tag}`), security_releases: [{ version: c.current }] }] });
  });
  it("exits 2 when Docker Hub has no tag for a move with no newer security release once its wait has ended, as before", async () => {
    const root = project(c.none);
    const { exit, out, err } = await scan(root, c.until, [c.tag]);
    expect(exit).toBe(2);
    expect(err).toContain(`${ecosystem}: unavailable — ${noTag(c, ecosystem)}`);
    expect(out.join("\n")).not.toContain("security release newer than");
    const report = await scanProject(root);
    expect(report.status).toBe("attention_required");
    expect(report.checks).toEqual([{ ecosystem, error: noTag(c, ecosystem) }]);
    const json = await scan(root, c.until, [c.tag], ["--json"]);
    expect(json.exit).toBe(2);
    expect(JSON.parse(json.out.join("\n")).checks[0]).not.toHaveProperty("security_releases");
  });
  it("exits 0 for a move with no newer security release while it waits, without asking Docker Hub for the tag, as before", async () => {
    const { exit } = await scan(project(c.none), before(c.until), [c.tag]);
    expect(exit).toBe(0);
  });
});
