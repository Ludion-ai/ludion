// dist/llms.txt (llmstxt.org): what Ludion is and what it does not do.
import { siteData } from "../build/data.ts";
import { llmsTxt } from "../build/discovery.ts";

export async function GET(): Promise<Response> {
  const { config } = await siteData();
  return new Response(llmsTxt(config.site), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
