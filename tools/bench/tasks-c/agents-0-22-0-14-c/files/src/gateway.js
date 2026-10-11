import { DurableObject } from 'cloudflare:workers';

// A plain Durable Object (not an Agent). Our other Workers call listTools() over RPC.
export class ToolGateway extends DurableObject {
  async listTools() {
    // TODO: return the tools of the MCP server at env.TOOLS_MCP_URL
    return [];
  }
}
