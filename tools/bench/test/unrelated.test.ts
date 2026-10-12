import { describe, expect, it } from "vitest";
import { splitLessons, withUnrelated } from "../src/unrelated.ts";

const md = [
  "# Lessons from Ludion",
  "",
  "Data line.",
  "",
  "- wrangler >=4.1.0 changed what `a`. (installed: wrangler 4.148.0)",
  "  Taught by @Ludion-ai, drafted by an agent; verified by test.",
  "- agents >=0.2.0 removed `b`. (installed: agents 0.27.0)",
  "  Taught by @Ludion-ai, drafted by an agent; verified by test.",
  "",
  "Ludion has no lessons at all for these dependencies: zod.",
  "",
].join("\n");

describe("experiment 3: unrelated lessons", () => {
  it("finds the lesson blocks and their packages", () => {
    const { head, blocks, tail } = splitLessons(md);
    expect(head).toHaveLength(4);
    expect(blocks.map((b) => b.package)).toEqual(["wrangler", "agents"]);
    expect(tail).toEqual(["", "Ludion has no lessons at all for these dependencies: zod."]);
  });

  it("merges extra lessons in package order and leaves the rest of the file alone", () => {
    const extra = [{ package: "hono", lines: ["- hono >=4.0.0 changed what `c`. (installed: hono 4.9.0)", "  Taught by @Ludion-ai."] as [string, string] }];
    const out = withUnrelated(md, extra);
    expect(splitLessons(out).blocks.map((b) => b.package)).toEqual(["agents", "hono", "wrangler"]);
    expect(out.startsWith("# Lessons from Ludion\n\nData line.\n\n- agents")).toBe(true);
    expect(out.endsWith("Ludion has no lessons at all for these dependencies: zod.\n")).toBe(true);
    expect(withUnrelated(md, [])).toBe(md);
  });
});
