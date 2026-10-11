// dist/index/subjects.json: which subjects have lessons, so `ludion sync` fetches only shards that exist.
import { siteData } from "../../build/data.ts";
import { shardsOf } from "../../build/shards.ts";

export async function GET(): Promise<Response> {
  const { index } = await siteData();
  const { built_at, subjects } = shardsOf(index);
  return new Response(JSON.stringify({ built_at, subjects }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}