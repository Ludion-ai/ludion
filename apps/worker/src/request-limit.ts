/** Public MCP inputs are bounded before the SDK parses JSON, including requests without a truthful length header. */
export const MAX_MCP_BODY_BYTES = 64 * 1024;

export async function boundedMcpRequest(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  const tooLarge = () => new Response("MCP request body is too large.", { status: 413, headers: { "Access-Control-Allow-Origin": "*" } });
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_MCP_BODY_BYTES) {
    void request.body.cancel().catch(() => {});
    return tooLarge();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MCP_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return tooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new Request(request, { body });
}
