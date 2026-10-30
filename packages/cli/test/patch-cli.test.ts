// `ludion patch`'s text for each fix. The patch itself is replaced for this file only (each test file has its own module
// graph): the receipts are written here, so no Docker, registry or OSV is used.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FixReceipt } from "../src/security/dependency-patch.ts";

const state = vi.hoisted(() => ({ fixes: [] as unknown[] }));
vi.mock("../src/security/dependency-patch.ts", async original => {
  const actual = await original<typeof import("../src/security/dependency-patch.ts")>();
  return { ...actual, patchDependencies: async () => ({ scan: { status: "vulnerable" }, path: "receipt.json", receipt: { outcome: "failed", reason: null, fixes: state.fixes } }) };
});
const { securityCli } = await import("../src/security/cli.ts");

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-patch-cli-"));
  writeFileSync(join(root, "ludion.security.json"), JSON.stringify({ schema: 1, ecosystem: "npm", test: ["node", "test.cjs"], timeout_seconds: 30 }));
  return root;
}
const NOTE = "4.17.21 cannot be used (deprecated: Bad release). 4.17.22 is the next smallest 4.x version, but it is not taken, and this fix stops.";
const fix = (over: Partial<FixReceipt>) => ({ package: "lodash", changes: [{ name: "lodash", from: "4.17.20", to: "4.17.21" }], outcome: "failed", branch: null, reason: null, ...over });
const choice = (skipped: { version: string; reason: string }[]) => ({ package: "lodash", smallest: "4.17.21", chosen: null, skipped, note: NOTE });
const times = (text: string, part: string) => text.split(part).length - 1;

describe("ludion patch, a fix's version choice", () => {
  let out: string[];
  beforeEach(() => {
    out = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => { out.push(line); });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("prints a stopped fix's note once: its reason already carries it", async () => {
    state.fixes = [fix({ reason: `Gate 2 stops this fix: ${NOTE}`, version_choice: [choice([{ version: "4.17.21", reason: "deprecated: Bad release" }])] as FixReceipt["version_choice"] })];
    expect(await securityCli("patch", ["--dir", project()])).toBe(2);
    expect(times(out.join("\n"), NOTE)).toBe(1);
    expect(out).toContain(`  lodash 4.17.20 → 4.17.21: failed — Gate 2 stops this fix: ${NOTE}`);
    // No line is left with nothing on it.
    expect(out.filter(line => !line.trim())).toEqual([]);
  });
  it("keeps the versions passed over for a stopped fix, without its note again", async () => {
    state.fixes = [fix({ reason: `Gate 2 stops this fix: ${NOTE}`, version_choice: [choice([{ version: "4.17.21", reason: "deprecated: Bad release" }, { version: "4.17.22", reason: "named by OSV: GHSA-test-0003" }])] as FixReceipt["version_choice"] })];
    await securityCli("patch", ["--dir", project()]);
    expect(times(out.join("\n"), NOTE)).toBe(1);
    expect(out).toContain("    Passed over: 4.17.21 (deprecated: Bad release), 4.17.22 (named by OSV: GHSA-test-0003).");
  });
  it("prints the note of a fix that took the next version, where no reason carries it", async () => {
    state.fixes = [fix({ outcome: "validated", version_choice: [{ ...choice([{ version: "4.17.21", reason: "deprecated: Bad release" }]), chosen: "4.17.22" }] as FixReceipt["version_choice"] })];
    await securityCli("patch", ["--dir", project()]);
    expect(out).toContain(`    ${NOTE}`);
    expect(times(out.join("\n"), NOTE)).toBe(1);
  });
  // Each note is printed once, never zero times: only the reason dependency-patch.ts writes for a choice's publisher
  // check leaves that choice's note out (docs/mistakes/2026-10-30-lv4-fixes-not-held-by-tests.md).
  it("prints the note of a fix that took the next version and then failed validation: its reason does not carry it", async () => {
    state.fixes = [fix({ reason: "Application validation failed (1): test failed", version_choice: [{ ...choice([{ version: "4.17.21", reason: "deprecated: Bad release" }]), chosen: "4.17.22" }] as FixReceipt["version_choice"] })];
    await securityCli("patch", ["--dir", project()]);
    expect(out).toContain("  lodash 4.17.20 → 4.17.21: failed — Application validation failed (1): test failed");
    expect(out).toContain(`    ${NOTE}`);
    expect(times(out.join("\n"), NOTE)).toBe(1);
  });
  it("prints a fix's second choice's note when its reason carries only the first's", async () => {
    const second = "3.10.2 cannot be used (no longer listed). No other 3.x version fixes it, and this fix stops.";
    state.fixes = [fix({
      changes: [{ name: "lodash", from: "4.17.20", to: "4.17.21", advisories: [] }, { name: "lodash", from: "3.10.1", to: "3.10.2", advisories: [] }],
      reason: `Gate 2 stops this fix: ${NOTE}`,
      version_choice: [choice([{ version: "4.17.21", reason: "deprecated: Bad release" }]), { package: "lodash", smallest: "3.10.2", chosen: null, skipped: [{ version: "3.10.2", reason: "no longer listed" }], note: second }] as FixReceipt["version_choice"],
    })];
    await securityCli("patch", ["--dir", project()]);
    expect(times(out.join("\n"), NOTE)).toBe(1);
    expect(out).toContain(`    ${second}`);
    expect(times(out.join("\n"), second)).toBe(1);
  });
});
