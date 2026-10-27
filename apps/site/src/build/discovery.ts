// /sitemap.xml and /llms.txt.
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sitemap lists the home page and the setup page. */
export function sitemap({ site, builtAt }: { site: string; builtAt: string }): string {
  const urls = [
    { loc: `${site}/`, lastmod: builtAt.slice(0, 10) },
    { loc: `${site}/start/` },
  ];
  const body = urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Product scope for agents and machine clients. */
export function llmsTxt(site: string): string {
 return `# Ludion

> One workflow for security updates across PHP Docker, npm, Composer and Maven.

Source preview: detect known advisories, acquire dependencies separately, test old/new application images offline, recheck the candidate and apply only under --apply policy.

Coverage: exact single-stage official PHP Docker images; public npm package-lock v2/v3; Composer lockfiles with supported pinned public ZIP archives; standalone Maven resolved dependency graphs via public Central. Parents/profiles/modules/extensions, custom registries, major upgrades and unsupported offline builds require review. Yarn/pnpm discovery is partial. Python, Go, Rust, Gradle, live server inventory and automatic production deployment are unsupported. A missing update is not evidence that a project is secure. Package coordinates are sent to OSV; application source is not uploaded to Ludion.

- [Try the source preview](${site}/start/): init, scan, patch and watch.

The lesson data and MCP endpoints of ludion-ai 0.1.x (/index.json, /index/*, /mcp) ended on 2026-10-28.
`;
}
