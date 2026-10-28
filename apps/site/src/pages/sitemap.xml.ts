// dist/sitemap.xml: the public pages, for search engines.
import { siteData } from "../build/data.ts";
import { sitemap } from "../build/discovery.ts";

export async function GET(): Promise<Response> {
  const { config, builtAt } = await siteData();
  const body = sitemap({ site: config.site, builtAt });
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
