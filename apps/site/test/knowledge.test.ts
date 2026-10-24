// Guard copy and the mark color. The knowledge strips and /bench page are gone.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "../src/strings/en.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

function texts(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) texts(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) texts(item, out);
  return out;
}

describe("the guard", () => {
  it("names exactly the four states, and only applicable goes on to execution", () => {
    expect(en.home.guard.states.map((state) => state.id)).toEqual(["applicable", "inapplicable", "unknown", "stale"]);
    const going = en.home.guard.states.filter((state) => /go(?:ing)? on to \w* ?execution/i.test(state.detail));
    expect(going.map((state) => state.id)).toEqual(["applicable"]);
  });
});

describe("v3 copy", () => {
  it("leaves every result pending and puts no metric digits in the design copy", () => {
    expect(en.home.receipt.pending).toBe("Pending");
    const ordinals = new Set([en.home.isolate.install, en.home.isolate.run]);
    const copy = [
      ...texts(en.home.guard),
      ...texts(en.home.verify),
      ...texts(en.home.receipt),
      en.home.sub,
      ...en.home.headline,
      ...texts(en.home.isolate).filter((text) => !ordinals.has(text)),
    ];
    // "v3" is the product name. The two ordinal step labels are excluded above. Any other digit is a metric.
    for (const text of copy) expect(text.replaceAll("v3", ""), text).not.toMatch(/\d/);
  });

  it("labels every illustration as a design example", () => {
    const label = "Design example, not a run result.";
    expect(en.home.scene.caption).toContain(label);
    expect(en.home.isolate.scope).toContain(label);
    expect(en.home.receipt.scope).toContain(label);
  });

  it("keeps the unverified wording and never the forbidden names", () => {
    const source = readFileSync(new URL("../src/strings/en.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Capability Compiler");
    expect(source).not.toContain("independent verifier");
    expect(source).not.toContain("/lessons/");
    expect(en.home.sub).toContain("meant to run only when its guard says applicable");
    expect(en.home.sub).toContain("meant to be judged by a fixed verifier");
    expect(en.home.sub).toContain("Nothing here is verified yet.");
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
