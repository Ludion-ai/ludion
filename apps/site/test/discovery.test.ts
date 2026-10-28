import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { llmsTxt, sitemap } from "../src/build/discovery.ts";

const SECTION_A = [
  "/models / 301",
  "/models/ / 301",
  "/lessons /start/ 301",
  "/lessons/* /start/ 301",
  "/teachers/* /start/ 301",
  "/bench / 301",
  "/bench/* / 301",
  "/bench.json / 301",
];

describe("being found", () => {
  it("lists only the home page and setup in the sitemap", () => {
    const xml = sitemap({ site: "https://ludion.ai", builtAt: "2026-10-12T00:00:00Z" });
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(["https://ludion.ai/", "https://ludion.ai/start/"]);
    expect(xml).toContain("<lastmod>2026-10-12</lastmod>");
    expect(xml).not.toContain("/lessons/");
    expect(xml).not.toContain("/bench");
    expect(xml).not.toContain("/@");
  });

  it("describes the security source preview and says the old endpoints ended", () => {
    const txt = llmsTxt("https://ludion.ai");
    expect(txt).toContain("One workflow for security updates across PHP Docker, npm, Composer and Maven.");
    expect(txt).toContain("Python, Go, Rust, Gradle, live server inventory and automatic production deployment are unsupported.");
    expect(txt).toContain("(/index.json, /index/*, /mcp) ended on 2026-10-28");
    expect(txt).not.toContain("https://ludion.ai/index.json");
    expect(txt).toContain("https://ludion.ai/start/");
    expect(txt).not.toContain("Ludion v3 (in design)");
  });

  it("redirects removed pages and never the home page or setup", () => {
    const text = readFileSync(new URL("../public/_redirects", import.meta.url), "utf8");
    for (const line of SECTION_A) expect(text).toContain(line);
    const froms = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(/\s+/)[0]);
    expect(froms).not.toContain("/");
    expect(froms).not.toContain("/start");
    expect(froms).not.toContain("/start/");
    for (const line of text.split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      expect(line).toContain(" 301");
    }
  });
});
