// Guard copy and the mark color. The knowledge strips and /bench page are gone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/strings/en.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe("security preview claims", () => {
  it("distinguishes an update, no match, unavailable metadata and unsupported input", () => {
    expect(en.home.guard.states.map(s => s.id)).toEqual(["update", "no-match", "unknown", "unsupported"]);
    expect(en.home.guard.states.find(s => s.id === "no-match")?.detail).toContain("not a guarantee");
    expect(en.home.guard.note).toContain("Dependency advisories come from OSV");
    expect(en.home.supported).toHaveLength(4);
    expect(en.home.supportedNote).toContain("Yarn/pnpm discovery is partial");
  });
  it("does not present illustrations or source updates as completed production remediation", () => {
    expect(en.home.isolate.scope).toContain("not a completed update");
    expect(en.home.receipt.scope).toContain("not a run result");
    expect(en.home.receipt.notDeployed).toBe("Not changed");
    expect(en.home.coverage).toContain("production deployment stays with your release process");
    expect(en.home.supportedNote).toContain("automatic production deployment are not supported");
  });
  it("retains explicit application validation and user policy before source changes", () => {
    expect(en.home.isolate.applyDetail).toContain("--apply");
    expect(en.home.verify.notVerified).toContain("failed baseline");
    expect(en.home.verify.notVerified).toContain("changed project");
    expect(en.home.verify.sameModel).toContain("does not invent a passing test");
  });
});

describe("--mark", () => {
  // WCAG relative luminance and contrast ratio.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const css = readFileSync(join(root, "apps/site/src/styles/tokens.css"), "utf8");
  const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
  const token = (block: string, name: string) => new RegExp(String.raw`--${name}:\s*(#[0-9a-f]{6})`).exec(block)![1]!;

  it.each([
    ["light", css],
    ["dark", dark],
  ])("stands out from the page and its panels in %s (3:1 for marks), as does not measured", (_, block) => {
    for (const bg of ["paper", "paper-2"]) expect(ratio(token(block, "mark"), token(block, bg)), bg).toBeGreaterThanOrEqual(3);
    expect(ratio(token(block, "checking-line"), token(block, "paper"))).toBeGreaterThanOrEqual(3);
  });
});
