// Asks the site's MCP server one question through ludion_ask and prints what it returns (Done 2, "ludion_ask returns it").
//   node docs/bench/2026-10-13-done2/ask.ts ["question"] [--site https://ludion.ai]
const args = process.argv.slice(2);
const siteAt = args.indexOf("--site");
const site = siteAt >= 0 ? args.splice(siteAt, 2)[1]! : "https://ludion.ai";
const question = args[0] ?? "Does vi.restoreAllMocks reset the call history of vi.fn mocks in vitest 4?";

async function rpc(body: unknown, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`${site}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") : text;
  return json ? JSON.parse(json) : null;
}

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ludion-done2-ask", version: "1" } },
});
const reply = await rpc(
  { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ludion_ask", arguments: { question } } },
  { "mcp-protocol-version": init.result.protocolVersion },
);
console.log((reply.result?.content ?? []).map((c: { text?: string }) => c.text ?? "").join("\n"));
