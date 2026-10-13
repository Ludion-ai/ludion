// dist/bench.json: the /bench tables as data, with where their numbers come from.
import { benchJson } from "../build/bench.ts";
import { siteData } from "../build/data.ts";

export async function GET(): Promise<Response> {
  const { done3, models, index, config } = await siteData();
  const subjectOf = new Map(index.lessons.map((l) => [l.id, l.subject]));
  const body = benchJson(done3, models, subjectOf, `https://github.com/${config.org}/${config.repo}`);
  return new Response(JSON.stringify(body, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}
