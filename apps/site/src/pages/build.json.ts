// dist/build.json: when this version was built. tools/check-production.ts waits for it to change after a deploy.
import { siteData } from "../build/data.ts";

export async function GET(): Promise<Response> {
  const { builtAt } = await siteData();
  return new Response(JSON.stringify({ built_at: builtAt }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
