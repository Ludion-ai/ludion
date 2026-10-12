// Step 1 of the seed pipeline: every changelog entry of a package's releases in a version range.
// Versions and dates come from the npm registry; entries from the GitHub release notes of each version.
import semver from "semver";

export interface Release {
  version: string;
  /** When npm published it. */
  date: string;
  tag: string;
  url: string;
  /** The release notes, as GitHub has them. */
  body: string;
}

export interface Entry {
  /** `<version>#<n>`, n counting from 1 in the order of the notes. */
  id: string;
  version: string;
  date: string;
  /** The heading above it (Breaking Changes, Minor Changes, Patch Changes, Features, …), or "". */
  section: string;
  /** The entry's markdown, with its continuation lines. */
  text: string;
  /** Pull request or issue numbers it links. */
  refs: number[];
  /** The release page. */
  url: string;
}

export interface Registry {
  repo: string;
  versions: { version: string; date: string }[];
}

type Fetch = (url: string) => Promise<Response>;

/** owner/repo from a registry `repository` field (git+https://github.com/o/r.git, github:o/r, o/r). */
export function githubRepo(repository: unknown): string | undefined {
  const url = typeof repository === "string" ? repository : (repository as { url?: string } | undefined)?.url;
  if (!url) return undefined;
  const m = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[/#].*)?$/.exec(url) ?? /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** Stable versions of a package inside `range` (and published on or after `since`, if given), oldest first, with npm's publish dates. */
export async function registry(pkg: string, range: string, fetchFn: Fetch = fetch, since?: string): Promise<Registry> {
  const res = await fetchFn(`https://registry.npmjs.org/${pkg.replace("/", "%2F")}`);
  if (!res.ok) throw new Error(`npm registry answered ${res.status} for ${pkg}.`);
  const doc = (await res.json()) as { repository?: unknown; time: Record<string, string>; versions: Record<string, unknown> };
  const repo = githubRepo(doc.repository);
  if (!repo) throw new Error(`${pkg} names no GitHub repository; the pipeline reads release notes from GitHub.`);
  const versions = Object.keys(doc.versions)
    .filter((v) => !semver.prerelease(v) && semver.satisfies(v, range) && (!since || (doc.time[v] ?? "") >= since))
    .sort(semver.compare)
    .map((version) => ({ version, date: doc.time[version] ?? "" }));
  return { repo, versions };
}

/** The tags a release of `version` might have: v1.2.3, 1.2.3, pkg@1.2.3 (monorepos with changesets). */
export function tagCandidates(pkg: string, version: string): string[] {
  return [`${pkg}@${version}`, `v${version}`, version, `sdk-v${version}`];
}

/**
 * Split release notes into entries: each top-level list item (`- ` or `* ` at column 0) with the indented or blank
 * lines after it. Headings set the section. Dependency bumps ("Updated dependencies") are dropped: they say nothing
 * about this package's own behavior.
 */
export function splitEntries(release: Release): Entry[] {
  const entries: Entry[] = [];
  let section = "";
  let current: string[] | null = null;
  const flush = () => {
    if (!current) return;
    const text = current.join("\n").trimEnd();
    current = null;
    if (/^[-*]\s+Updated dependencies/i.test(text)) return;
    const refs = [...new Set([...text.matchAll(/(?:\/(?:pull|issues)\/|#)(\d{2,6})\b/g)].map((m) => Number(m[1])))];
    entries.push({ id: `${release.version}#${entries.length + 1}`, version: release.version, date: release.date, section, text, refs, url: release.url });
  };
  for (const line of release.body.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      section = heading[1]!.replace(/&nbsp;|[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim();
      continue;
    }
    if (/^[-*]\s+\S/.test(line)) {
      flush();
      current = [line];
    } else if (current && (line.trim() === "" || /^\s+\S/.test(line))) {
      current.push(line);
    } else {
      flush();
    }
  }
  flush();
  return entries;
}

export type Gh = (args: string[]) => string;

/** Release notes for each version, from GitHub. Versions with no release (or an empty one) are listed separately. */
export function releases(pkg: string, reg: Registry, gh: Gh): { found: Release[]; missing: string[] } {
  const found: Release[] = [];
  const missing: string[] = [];
  for (const { version, date } of reg.versions) {
    let release: Release | undefined;
    for (const tag of tagCandidates(pkg, version)) {
      try {
        const r = JSON.parse(gh(["api", `repos/${reg.repo}/releases/tags/${encodeURIComponent(tag)}`])) as { body?: string; html_url: string; tag_name: string };
        if (r.body?.trim()) release = { version, date, tag: r.tag_name, url: r.html_url, body: r.body };
        break;
      } catch {
        // Not this tag; try the next form.
      }
    }
    if (release) found.push(release);
    else missing.push(version);
  }
  return { found, missing };
}
