import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { siteData } from "../src/build/data.ts";
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
  it("lists only the home page and sync setup in the sitemap", () => {
    const xml = sitemap({ site: "https://ludion.ai", builtAt: "2026-10-12T00:00:00Z" });
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual(["https://ludion.ai/", "https://ludion.ai/start/"]);
    expect(xml).toContain("<lastmod>2026-10-12</lastmod>");
    expect(xml).not.toContain("/lessons/");
    expect(xml).not.toContain("/bench");
    expect(xml).not.toContain("/@");
  });

  it("writes llms.txt for Ludion v3 in design, with the coverage caveat and no lesson or bench pages", () => {
    const txt = llmsTxt("https://ludion.ai");
    expect(txt.startsWith("# Ludion\n\n> Ludion v3 (in design)")).toBe(true);
    expect(txt).toContain("Nothing here is verified yet.");
    expect(txt).toContain("some changes of some packages, not all of them");
    expect(txt).toContain("No lesson for something is no evidence that it didn't change.");
    expect(txt).toContain("https://ludion.ai/index.json");
    expect(txt).toContain("every active lesson, machine-readable.");
    expect(txt).toContain("https://ludion.ai/index/subjects.json");
    expect(txt).not.toContain("/lessons/");
    expect(txt).not.toContain("/bench");
    expect(txt).not.toContain("Capability Compiler");
  });

  it("redirects removed pages and never the home page or sync setup", () => {
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

  it("gives every subject in the built index a real 301, with and without the trailing slash", async () => {
    const { index } = await siteData();
    const subjects = [...new Set(index.lessons.map((lesson) => lesson.subject))];
    const text = readFileSync(new URL("../public/_redirects", import.meta.url), "utf8");
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(subjects.length).toBeGreaterThan(0);
    for (const subject of subjects) {
      expect(lines, subject).toContain(`/${subject} /start/ 301`);
      expect(lines, subject).toContain(`/${subject}/ /start/ 301`);
    }
    const froms = lines.map((line) => line.split(/\s+/)[0]);
    for (const path of ["/", "/start", "/start/", "/index.json", "/no-such-page/"]) expect(froms, path).not.toContain(path);
    expect(froms.filter((from) => from?.startsWith("/index/"))).toEqual([]);
  }, 120_000);
});
