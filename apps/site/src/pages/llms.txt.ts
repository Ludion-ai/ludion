// dist/llms.txt (llmstxt.org): what Ludion is, where its data is, and every active lesson (docs/decisions.md, "Being found").
import { siteData } from "../build/data.ts";
import { llmsTxt } from "../build/discovery.ts";

export async function GET(): Promise<Response> {
  const { config, index } = await siteData();
  return new Response(llmsTxt(config.site, index), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
