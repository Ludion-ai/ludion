import { describe, expect, it } from "vitest";
import { EVIDENCE_SCOPE, buildIndex, evidenceLabel, formatLesson, generateClaim, type LessonV1 } from "../src/index.ts";
import { verifyLesson } from "../../../tools/verify/src/verify.ts";
import { renderLessons } from "../../cli/src/render.ts";
import { shardLesson } from "../../cli/src/shards.ts";
import { formatAsk, toAskLesson } from "../../../apps/worker/src/mcp/ask.ts";
import { llmsTxt } from "../../../apps/site/src/build/discovery.ts";

describe("evidence checks do not imply semantic validation", () => {
  it("does not present an inverted source-backed claim as machine-validated truth on any delivery surface", async () => {
    const quote = "The new --repeats CLI option repeats every test a given number of times regardless of the result.";
    const inverted: LessonV1 = {
      format: 1, id: "01M4N6JH8SHRYQE5CPY9SN1QQJ", subject: "vitest", package: { ecosystem: "npm", name: "vitest" },
      versions: ">=4.0.0", kind: "removed", symbol: "--repeats", signal: "silent",
      evidence: [{ source: { url: "https://vitest.dev/blog/vitest-5", quote } }], author: "github:alice", author_id: 1, created_at: "2026-10-12T00:00:00Z",
    };
    // Presence really can pass for an inverted claim: do not pretend a lexical guard proves its meaning.
    const r = await verifyLesson({ path: `lessons/vitest/${inverted.id}.json`, text: formatLesson(inverted) }, { base: [], fetchFn: async () => new Response(quote, { headers: { "content-type": "text/plain" } }) });
    expect(r.status).toBe("passed");
    const index = buildIndex([inverted], {}, new Map([[1, "alice"]]), { org: "example", repo: "example" });
    const entry = index.lessons[0]!;
    expect(entry.verification_scope).toBe(EVIDENCE_SCOPE);
    expect(entry.claim).toBe(generateClaim(inverted));
    expect(evidenceLabel(entry.verified_by)).toBe("quote found");
    const syncLesson = shardLesson(entry)!;
    const md = renderLessons({ kept: [{ lesson: syncLesson, versions: ["5.0.3"] }], prunedForModel: [] }, "vitest 5.0.3", new Date());
    const ask = toAskLesson(entry, "https://ludion.ai");
    expect(ask.verification_scope).toBe(EVIDENCE_SCOPE);
    for (const text of [md, formatAsk([ask]), llmsTxt("https://ludion.ai", index)]) {
      expect(text).toContain(EVIDENCE_SCOPE);
      expect(text).toContain("quote found");
      expect(text).not.toMatch(/verified by source/i);
    }
  });
});
