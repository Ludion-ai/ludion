// dist/sitemap.xml: every page of the site, for search engines (docs/decisions.md, "Being found").
import { siteData } from "../build/data.ts";
import { sitemap } from "../build/discovery.ts";

export async function GET(): Promise<Response> {
  const { config, index, pages, tombstones, teacherPages } = await siteData();
  const body = sitemap({
    site: config.site,
    index,
    lessonPages: [...pages.map((p) => ({ id: p.lesson.id, lastmod: p.verified_at })), ...tombstones.map((t) => ({ id: t.id, lastmod: t.retracted_at }))],
    subjects: [...new Set(index.lessons.map((l) => l.subject))].sort(),
    teacherLogins: [...teacherPages.keys()].sort(),
  });
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
