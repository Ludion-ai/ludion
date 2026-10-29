// /sitemap.xml and /llms.txt.
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sitemap lists the home page and the setup page, in English and in Japanese. */
export function sitemap({ site, builtAt }: { site: string; builtAt: string }): string {
  const urls = [
    { loc: `${site}/`, lastmod: builtAt.slice(0, 10) },
    { loc: `${site}/start/` },
    { loc: `${site}/ja/`, lastmod: builtAt.slice(0, 10) },
    { loc: `${site}/ja/start/` },
  ];
  const body = urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/** Product scope for agents and machine clients. */
export function llmsTxt(site: string): string {
 return `# Ludion

> A judge for npm dependency-update PRs: it reads the PR's lockfile change and leaves one comment.

Preview, not released: comments only. It changes no file and merges nothing. It checks parts of gates 1, 2 and 4 and the wait: provenance, publisher, install scripts, OSV malicious-package (MAL-) records, deprecation, withdrawal, new dependencies, versions that move with the fix, and the lockfile's tarballs and hashes. Verdicts: stop, wait, ready_except_build, undecidable. It does not build or test anything (gate 3), so it never says an update can be applied. Every changed version counts as production.

Scope: npm only; package-lock.json v2/v3, the root package.json and each changed */package.json. A pnpm-lock.yaml is read only by the local command and is always undecidable; a PR that changes .github/ or 300 or more files is undecidable. Ludion does not find vulnerabilities or write updates: Dependabot, Renovate or a person opens the PR. A hijacked publisher account with no provenance change is caught only by the wait and by running the judge again when it ends. No comment means neither safe nor cleared. Package names and versions are sent to OSV and the npm registry; no source is sent.

- [Try the preview](${site}/start/): two GitHub workflows, or the judge run locally.

The lesson data and MCP endpoints of ludion-ai 0.1.x (/index.json, /index/*, /mcp) ended on 2026-10-28.
`;
}
