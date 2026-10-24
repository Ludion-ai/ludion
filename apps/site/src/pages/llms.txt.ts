// dist/llms.txt (llmstxt.org): what Ludion is, and where today's sync data lives.
import { siteData } from "../build/data.ts";
import { llmsTxt } from "../build/discovery.ts";

export async function GET(): Promise<Response> {
  const { config } = await siteData();
  return new Response(llmsTxt(config.site), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
