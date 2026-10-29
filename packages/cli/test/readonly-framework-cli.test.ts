// `ludion scan` end to end with a registered read-only reader. The reader registry is replaced for this file only
// (each test file has its own module graph), and OSV is a fake global fetch: no network.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadOnlyInventory } from "../src/security/readonly/types.ts";

const state = vi.hoisted(() => ({ read: (_root: string): ReadOnlyInventory | null => null }));
vi.mock("../src/security/readonly/index.ts", async original => {
  const actual = await original<typeof import("../src/security/readonly/index.ts")>();
  return { ...actual, READONLY_READERS: [{ ecosystem: "crates.io", files: actual.RUST_FILES, read: (root: string) => state.read(root) }] };
});
const { securityCli } = await import("../src/security/cli.ts");

const response = (value: unknown) => new Response(JSON.stringify(value));
const informational = { id: "RUSTSEC-2024-0375", summary: "atty is unmaintained", aliases: [], affected: [{ package: { ecosystem: "crates.io", name: "atty" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0.0.0-0" }] }], database_specific: { informational: "unmaintained" } }] };
// OSV's own cleanup strips C0 characters only; the C1 CSI (U+009B) must not reach the terminal either.
const vulnerability = { id: "GHSA-g98v-hv3f-hcfr", summary: "Potential\u009bunaligned read",aliases: ["RUSTSEC-2021-0145"], affected: [{ package: { ecosystem: "crates.io", name: "atty" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "0.2.14" }] }] }] };
function osv(records: { id: string }[]) {
  vi.stubGlobal("fetch", async (url: string) => {
    const id = decodeURIComponent(String(url).split("/vulns/")[1] ?? "");
    if (id) return response(records.find(r => r.id === id));
    return response({ results: [records.length ? { vulns: records.map(r => ({ id: r.id })) } : {}] });
  });
}
function project(): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-readonly-cli-"));
  writeFileSync(join(root, "Cargo.lock"), "version = 4\n");
  return root;
}
const atty = (limitations: string[] = []): ReadOnlyInventory => ({ ecosystem: "crates.io", files: ["Cargo.lock"], scope: "locked", packages: [{ name: "atty", version: "0.2.14", direct: true }], limitations });

describe("ludion scan with a registered read-only reader", () => {
  let out: string[], err: string[];
  beforeEach(() => {
    out = []; err = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
    vi.spyOn(console, "error").mockImplementation((line: string) => { err.push(line); });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("exits 0 when only informational advisories match, and lists them apart", async () => {
    state.read = () => atty(); osv([informational]);
    expect(await securityCli("scan", ["--dir", project()])).toBe(0);
    expect(out).toContain("crates.io: 1 package versions · 0 advisory matches · 1 informational · no_known_vulnerabilities");
    expect(out).toContain("  Informational (unmaintained, not counted as a vulnerability): atty@0.2.14 · RUSTSEC-2024-0375 · atty is unmaintained · OSV lists no fixed version");
    expect(out).toContain("  Read-only: Ludion reports known advisories for this ecosystem but does not plan or apply updates.");
  });
  it("exits 1 on a vulnerability and 2 on an incomplete inventory, as the other scans do", async () => {
    state.read = () => atty(); osv([informational, vulnerability]);
    expect(await securityCli("scan", ["--dir", project()])).toBe(1);
    expect(out).toContain("  atty@0.2.14 · GHSA-g98v-hv3f-hcfr · Potential unaligned read · OSV lists no fixed version");
    expect(out.join("\n")).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/);
    state.read = () => atty(["Cargo.toml: a git dependency is not checked."]); osv([informational]);
    expect(await securityCli("scan", ["--dir", project()])).toBe(2);
    expect(out).toContain("  Incomplete: Cargo.toml: a git dependency is not checked.");
  });
  it("prints a reader's error without control characters (exit 2)", async () => {
    state.read = () => { throw new Error("Cargo.lock line 3: \u001b]0;owned\u0007 \u009b31m unreadable"); }; osv([]);
    expect(await securityCli("scan", ["--dir", project(), "--ecosystem", "rust"])).toBe(2);
    expect(err).toEqual(["crates.io: unavailable — Cargo.lock line 3:  ]0;owned   31m unreadable"]);
    expect(err.join("")).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
  });
  it("--json keeps each finding's kind", async () => {
    state.read = () => atty(); osv([informational, vulnerability]);
    expect(await securityCli("scan", ["--dir", project(), "--json"])).toBe(1);
    const report = JSON.parse(out.join("\n"));
    expect(report.checks[0].result.findings.map((f: any) => [f.advisory.id, f.kind, f.informational ?? null])).toEqual([["RUSTSEC-2024-0375", "informational", "unmaintained"], ["GHSA-g98v-hv3f-hcfr", "vulnerability", null]]);
  });
});
