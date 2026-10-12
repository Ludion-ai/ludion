import { describe, expect, it } from "vitest";
import type { Index } from "@ludion/core";
import { llmsTxt, sitemap } from "../src/build/discovery.ts";

const entry = (id: string, subject: string, claim: string, extra: object = {}) =>
  ({ id, subject, claim, teacher: "alice", teacher_id: 1, verified_by: "differential", verified_at: "2026-10-11T03:00:00Z", evidence: [], replaces: [], pr: 1, url: "u", ...extra }) as Index["lessons"][number];
const index: Index = {
  version: 1,
  built_at: "2026-10-12T00:00:00Z",
  lessons: [entry("B", "wrangler", "wrangler >=4.1.0 changed what `x` does.", { drafted_by: "agent" }), entry("A", "agents", "agents >=0.2.0 removed `[y]`.")],
  teachers: {},
};

describe("being found", () => {
  it("lists every page in the sitemap, teacher pages at their canonical /@login, with XML escaped", () => {
    const xml = sitemap({ site: "https://ludion.ai", index, lessonPages: [{ id: "A", lastmod: "2026-10-11T03:00:00Z" }, { id: "T", lastmod: "2026-10-12T05:00:00Z" }], subjects: ["agents", "a&b"], teacherLogins: ["alice"] });
    expect(xml).toContain("<url><loc>https://ludion.ai/lessons/A/</loc><lastmod>2026-10-11</lastmod></url>");
    expect(xml).toContain("<loc>https://ludion.ai/lessons/T/</loc>");
    expect(xml).toContain("<loc>https://ludion.ai/a%26b/</loc>");
    expect(xml).toContain("<loc>https://ludion.ai/@alice</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(4 + 2 + 2 + 1);
  });

  it("writes llms.txt with the coverage caveat and each active lesson by subject, labeled, its claim untouched", () => {
    const txt = llmsTxt("https://ludion.ai", index);
    expect(txt.startsWith("# Ludion\n\n> ")).toBe(true);
    expect(txt).toContain("No lesson for something is no evidence that it didn't change.");
    expect(txt.indexOf("### agents")).toBeLessThan(txt.indexOf("### wrangler"));
    expect(txt).toContain("- [B](https://ludion.ai/lessons/B/): wrangler >=4.1.0 changed what `x` does. Taught by @alice, drafted by an agent; verified by tests across versions on 2026-10-11.");
    // The claim is served as is: brackets in a symbol stay (they sit inside a code span, outside the link).
    expect(txt).toContain("- [A](https://ludion.ai/lessons/A/): agents >=0.2.0 removed `[y]`. Taught by @alice;");
  });
});
