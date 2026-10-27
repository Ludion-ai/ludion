// /sitemap.xml and /llms.txt. Lesson and bench pages are gone; sync still publishes index.json.
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sitemap lists the home page and the sync setup page. */
export function sitemap({ site, builtAt }: { site: string; builtAt: string }): string {
  const urls = [
    { loc: `${site}/`, lastmod: builtAt.slice(0, 10) },
    { loc: `${site}/start/` },
  ];
  const body = urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Machine-readable product description. Legacy data remains available for existing clients. */
export function llmsTxt(site: string): string {
  return `# Ludion

> Security updates without following every advisory. The source preview finds official PHP Docker security releases, tests an update, and can patch the Dockerfile.

Supported scope: one-stage official PHP Docker images with an exact stable version and flavor. Same-branch updates only. Builds and application tests run offline in Docker. Automatic production deployment, live server inventory, Java and EOL certification are not supported. A missing update is not evidence that a project is secure.

## Use it

- [Try the source preview](${site}/start/): build this source revision; use ludion init, scan, patch and watch.
- The published npm 0.1.4 release still contains the legacy sync and teach commands.

## Legacy compatibility

- [index.json](${site}/index.json): legacy lesson data for existing clients, not a vulnerability database.
- [subjects.json](${site}/index/subjects.json): legacy sync subjects.
`;
}
