// dist/sitemap.xml: every page of the site, for search engines (docs/decisions.md, "Being found").
import { benchModels } from "../build/bench.ts";
import { siteData } from "../build/data.ts";
import { sitemap } from "../build/discovery.ts";

export async function GET(): Promise<Response> {
  const { config, index, pages, tombstones, teacherPages, done3, models } = await siteData();
  const body = sitemap({
    site: config.site,
    index,
    lessonPages: [...pages.map((p) => ({ id: p.lesson.id, lastmod: p.verified_at })), ...tombstones.map((t) => ({ id: t.id, lastmod: t.retracted_at }))],
    subjects: [...new Set(index.lessons.map((l) => l.subject))].sort(),
    teacherLogins: [...teacherPages.keys()].sort(),
    benchModels: benchModels(done3, models).map((m) => m.id),
  });
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
