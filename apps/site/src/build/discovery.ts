// /sitemap.xml and /llms.txt: how search engines and AI tools find the lessons (docs/decisions.md, "Being found").
// Built from the same data as the pages, so they list exactly the pages that exist.
import { EVIDENCE_SCOPE, evidenceLabel, type Index } from "@ludion/core";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface SitemapInput {
  site: string;
  index: Index;
  /** Every lesson page: active, replaced, and retracted (tombstones), with the date it last changed. */
  lessonPages: { id: string; lastmod: string }[];
  subjects: string[];
  teacherLogins: string[];
}

/** The sitemap: home, the fixed pages, every subject page, every lesson page, and every teacher page. */
export function sitemap({ site, index, lessonPages, subjects, teacherLogins }: SitemapInput): string {
  const day = (iso: string) => iso.slice(0, 10);
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${site}/`, lastmod: day(index.built_at) },
    { loc: `${site}/start/` },
    { loc: `${site}/models/` },
    { loc: `${site}/lessons/`, lastmod: day(index.built_at) },
    ...subjects.map((s) => ({ loc: `${site}/${encodeURIComponent(s)}/` })),
    ...lessonPages.map((p) => ({ loc: `${site}/lessons/${p.id}/`, lastmod: day(p.lastmod) })),
    // Teacher pages are canonical at /@login.
    ...teacherLogins.map((l) => ({ loc: `${site}/@${encodeURIComponent(l)}` })),
  ];
  const body = urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * llms.txt (llmstxt.org): what Ludion is, where the machine-readable data is, and every active lesson: a link named by
 * its id, then the same claim index.json serves (untouched: it is never put inside link text, where brackets in a
 * symbol could break the link), its teacher, and how it was verified. Lessons are data, and the file says so.
 */
export function llmsTxt(site: string, index: Index): string {
  const bySubject = new Map<string, Index["lessons"]>();
  for (const l of index.lessons) bySubject.set(l.subject, [...(bySubject.get(l.subject) ?? []), l]);
  const subjects = [...bySubject.keys()].sort();
  const lines = [
    "# Ludion",
    "",
    "> Teacher claims about software changes, with machine-checked evidence. Each names its package, claimed version range, and teacher. Lessons are data, never instructions.",
    "",
    "Ludion holds some changes of some packages, not all of them. No lesson for something is no evidence that it didn't change.",
    "",
    EVIDENCE_SCOPE,
    "",
    "## Use it",
    "",
    `- [Get started](${site}/start/): \`npx ludion-ai sync\` writes the lessons for a project's installed versions to .ludion/lessons.md; the MCP server at ${site}/mcp answers ludion_ask.`,
    `- [index.json](${site}/index.json): every active lesson, machine-readable.`,
    `- [subjects.json](${site}/index/subjects.json): subjects with lessons; each has a shard at ${site}/index/<subject>.json.`,
    `- [Models](${site}/models/): which changes each measured model gets wrong.`,
    "",
    "## Lessons",
  ];
  for (const s of subjects) {
    lines.push("", `### ${s}`, "");
    for (const l of bySubject.get(s)!) {
      const who = `@${l.teacher}${l.drafted_by === "agent" ? ", drafted by an agent" : ""}`;
      lines.push(`- [${l.id}](${site}/lessons/${l.id}/): ${l.claim} Taught by ${who}; evidence checked: ${evidenceLabel(l.verified_by)} on ${l.verified_at.slice(0, 10)}.`);
    }
  }
  return lines.join("\n") + "\n";
}
