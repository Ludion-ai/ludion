import { describe, expect, it } from "vitest";
import type { Index, IndexEntry } from "@ludion/core";
import { shardsOf } from "../src/build/shards.ts";

const entry = (over: Partial<IndexEntry>): IndexEntry => ({
  id: "A", subject: "vitest", claim: "c", evidence: [], teacher: "t", teacher_id: 1, replaces: [], verified_by: "test", verified_at: "2026-10-11T00:00:00Z", pr: 1, url: "u", ...over,
});

describe("shardsOf", () => {
  it("splits format 1 lessons by subject, leaves format 0 out, and adds measured model verdicts", () => {
    const index: Index = {
      version: 1,
      built_at: "2026-10-11T00:00:00Z",
      teachers: {},
      lessons: [entry({ id: "A", format: 1 }), entry({ id: "B", format: 1, subject: "wrangler" }), entry({ id: "C", subject: "python" })],
    };
    const s = shardsOf(index, { A: { "claude-opus-5-5": "misses" } });
    expect(s.subjects).toEqual({ vitest: { lessons: 1 }, wrangler: { lessons: 1 } });
    expect(s.shards.vitest!.lessons[0]).toMatchObject({ id: "A", models: { "claude-opus-5-5": "misses" } });
    expect(s.shards.wrangler!.lessons[0]).not.toHaveProperty("models");
    expect(s.shards.python).toBeUndefined();
  });
});