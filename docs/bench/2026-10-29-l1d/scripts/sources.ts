// L1d (docs/decisions/2026-10-29-l1d-third-sample.md): a repository's source tree at a recorded SHA, from GitHub's
// archive of that commit (codeload), extracted with node_modules left out and never run, as L1c fetched it, plus one
// check L1c did not make (cause A of docs/bench/2026-10-29-l1d/classification.md). The archive leaves out every path
// that a `.gitattributes` gives `export-ignore`, so the tree is marked incomplete when any `.gitattributes` the fetch
// can see sets it: the root one, read from raw.githubusercontent.com at the SHA (an archive can leave it out itself), and
// every one in the archive. An incomplete tree gets only D1, as the judge gives a tree it cannot read whole.
//
// Standalone, in Docker only (read-only root, non-root, no forwarded environment), for the rows of a measured sample:
//   node sources.ts <noise.json> <sources dir> <log file>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSourceTree } from "../../../../packages/cli/src/security/production.ts";

const ATTEMPTS = 3;
/** Files the fetch writes beside the tree; they are not the repository's. */
export const MARKERS = [".ludion-sha", ".ludion-incomplete"];

const sourceDir = (root: string, repo: string) => join(root, repo.replace("/", "__"));
const walk = (dir: string, rel = ""): string[] => readdirSync(join(dir, rel), { withFileTypes: true }).flatMap(d => {
  const path = rel ? `${rel}/${d.name}` : d.name;
  return d.isDirectory() ? walk(dir, path) : [path];
});

/** The lines of a `.gitattributes` that set `export-ignore` (not `-export-ignore` or `!export-ignore`), comments left out. */
export function exportIgnores(text: string): string[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#") && /(^|\s)export-ignore(=\S*)?(\s|$)/.test(l));
}

/** The root `.gitattributes` at the SHA: its text, null when there is none (HTTP 404). Anything else throws. */
async function rootAttributes(repo: string, sha: string): Promise<string | null> {
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/.gitattributes`, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`.gitattributes: HTTP ${res.status}`);
  return res.text();
}

/** Fetches and extracts the archive (three attempts), and records why the tree is incomplete, if it is. */
export async function fetchSource(root: string, repo: string, sha: string) {
  const dir = sourceDir(root, repo), tgz = join(root, `.tmp-${repo.replace("/", "__")}.tgz`);
  let entry: any = null;
  for (let attempt = 1; attempt <= ATTEMPTS && !entry?.ok; attempt++) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      writeFileSync(tgz, body);
      execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1", "--exclude=*/node_modules/*", "--exclude=*/node_modules", "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
      const files = walk(dir);
      const rootText = await rootAttributes(repo, sha);
      const ignores: { file: string; lines: string[] }[] = [];
      if (rootText !== null && exportIgnores(rootText).length) ignores.push({ file: ".gitattributes (raw.githubusercontent.com)", lines: exportIgnores(rootText) });
      for (const f of files.filter(f => f.split("/").at(-1) === ".gitattributes")) {
        const lines = exportIgnores(readFileSync(join(dir, f), "utf8"));
        if (lines.length) ignores.push({ file: f, lines });
      }
      if (ignores.length) writeFileSync(join(dir, ".ludion-incomplete"), `GitHub's archive leaves out export-ignore paths (${ignores.map(i => `${i.file}: ${i.lines.join("; ")}`).join(" | ").slice(0, 500)})`);
      writeFileSync(join(dir, ".ludion-sha"), sha);
      entry = { repo, sha, ok: true, attempt, archive_sha256: createHash("sha256").update(body).digest("hex"), archive_bytes: body.length, files: files.length, root_gitattributes: rootText !== null, export_ignore: ignores };
    } catch (e) {
      entry = { repo, sha, ok: false, attempt, error: String((e as Error)?.message ?? e).slice(0, 300) };
      if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 10_000 * attempt));
    } finally { rmSync(tgz, { force: true }); }
  }
  if (!entry.ok) rmSync(dir, { recursive: true, force: true });
  return entry;
}

/** The tree at the SHA, or null when it was not extracted for that SHA (then only D1 applies). */
export function sourceOf(root: string, repo: string, sha: string) {
  const dir = sourceDir(root, repo);
  if (!existsSync(join(dir, ".ludion-sha")) || readFileSync(join(dir, ".ludion-sha"), "utf8") !== sha) return null;
  const tree = readSourceTree(dir);
  const marked = existsSync(join(dir, ".ludion-incomplete")) ? readFileSync(join(dir, ".ludion-incomplete"), "utf8") : null;
  return { ...tree, files: tree.files.filter(f => !MARKERS.includes(f)), incomplete: tree.incomplete ?? marked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [noiseFile, root, logFile] = process.argv.slice(2);
  if (!noiseFile || !root || !logFile) throw new Error("Usage: node sources.ts <noise.json> <sources dir> <log file>");
  if (existsSync(logFile)) throw new Error(`${logFile} exists: a log is never overwritten.`);
  const rows: { repo: string; sha: string }[] = JSON.parse(readFileSync(noiseFile, "utf8")).rows;
  const log: any[] = [];
  for (const r of rows) {
    const e = await fetchSource(root, r.repo, r.sha);
    log.push(e);
    console.log(`${r.repo}: ${e.ok ? `ok, ${e.files} files${e.export_ignore.length ? ", export-ignore: incomplete" : ""}` : `failed: ${e.error}`}`);
  }
  writeFileSync(logFile, JSON.stringify({ fetched_at: new Date().toISOString(), noise: noiseFile, repositories: log }, null, 1));
}
