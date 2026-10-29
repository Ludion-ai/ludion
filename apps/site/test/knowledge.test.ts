// Guard copy and the mark color. The knowledge strips and /bench page are gone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/strings/en.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

describe("judge preview claims", () => {
  it("names the judge's four verdicts, none of them apply", () => {
    expect(en.home.guard.states.map(s => s.id)).toEqual(["stop", "wait", "ready_except_build", "undecidable"]);
    expect(en.home.guard.states.find(s => s.id === "ready_except_build")?.detail).toContain("not a verdict that the update can be applied");
    expect(en.home.guard.states.find(s => s.id === "undecidable")?.detail).toContain("never as clear");
    expect(en.home.guard.note).toContain("Every changed version counts as production");
    expect(en.home.supported).toHaveLength(4);
    expect(en.home.supportedNote).toContain("npm only");
  });
  it("does not present illustrations as judgements, or the preview as released or merging", () => {
    expect(en.home.isolate.scope).toContain("not a judgement");
    expect(en.home.receipt.scope).toContain("not a judgement");
    expect(en.home.receipt.notDeployed).toBe("Not run");
    expect(en.home.coverage).toContain("Preview, not released");
    expect(en.home.coverage).toContain("merges nothing");
  });
  it("says what the judge does not check, including gate 3 and a hijacked publisher", () => {
    expect(en.home.receipt.notChecked[0]).toContain("Gate 3");
    expect(en.home.verify.notVerified).toContain("gate 3");
    expect(en.home.verify.hijack).toContain("caught only by the wait");
    expect(en.home.isolate.unavailable).toContain("only when it runs again");
  });
  it("describes none of the removed commands, ecosystems or Docker validation", () => {
    expect(JSON.stringify(en)).not.toMatch(/--apply|\b(scan|patch|PHP|Composer|Maven|Docker|Dockerfile)\b/i);
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
