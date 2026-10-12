import { describe, expect, it } from "vitest";
import { exports } from "cloudflare:workers";
import { boundedMcpRequest, MAX_MCP_BODY_BYTES } from "../src/request-limit.ts";

describe("MCP body bound before JSON parsing", () => {
  it.each([undefined, "1", String(MAX_MCP_BODY_BYTES + 1)])("rejects oversized bodies with content-length=%s", async (length) => {
    const request = new Request("https://ludion.ai/mcp", { method: "POST", headers: length ? { "content-length": length } : {}, body: "x".repeat(MAX_MCP_BODY_BYTES + 1) });
    const response = await exports.default.fetch(request);
    expect(response.status).toBe(413);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("stops a streaming body at the bound and cancels it without buffering the rest", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(MAX_MCP_BODY_BYTES)); c.enqueue(new Uint8Array(1)); },
      cancel() { canceled = true; },
    });
    const result = await boundedMcpRequest(new Request("https://ludion.ai/mcp", { method: "POST", body: stream }));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(413);
    expect(canceled).toBe(true);
  });

  it("preserves valid UTF-8 requests and their headers", async () => {
    const text = JSON.stringify({ question: "最近の変更は？" });
    const result = await boundedMcpRequest(new Request("https://ludion.ai/mcp", { method: "POST", headers: { "content-type": "application/json", "mcp-protocol-version": "2025-06-18" }, body: text }));
    expect(result).toBeInstanceOf(Request);
    expect((result as Request).headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(await result.text()).toBe(text);
  });
});
