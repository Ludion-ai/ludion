// dist/index/subjects.json and dist/index/<subject>.json: the active set split by subject, so `ludion sync`
// downloads only the subjects a project installed. Built with the site, like index.json (docs/decisions.md).
import { siteData } from "../../build/data.ts";
import { shardsOf } from "../../build/shards.ts";

export async function getStaticPaths() {
  const { index } = await siteData();
  return Object.keys(shardsOf(index).subjects).map((subject) => ({ params: { subject } }));
}

export async function GET({ params }: { params: { subject: string } }): Promise<Response> {
  const { index } = await siteData();
  const shard = shardsOf(index).shards[params.subject];
  return new Response(JSON.stringify(shard), { headers: { "Content-Type": "application/json; charset=utf-8" } });
}