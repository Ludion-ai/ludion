// The rerun's source trees (docs/decisions.md, "Gate 1's production/dev split, rebuilt", section 4): each repository
// of the first run's sample, plus JakeWharton/jakewharton.com, at its recorded SHA from GitHub's archive of that commit,
// extracted (never run) into /src/<owner>__<repo>, node_modules folders left out. Three attempts each. The archive's
// SHA-256 and the extracted file count are recorded in /src/sources-log.json (copied into the bench folder).
// Runs in Docker with network: -v <first run's folder>:/d:ro -v ludion-l1-src:/src.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const first = JSON.parse(readFileSync("/d/noise.json", "utf8"));
const repos = [...first.rows.map(r => ({ repo: r.repo, sha: r.sha })), { repo: "JakeWharton/jakewharton.com", sha: "c660e5960d205157ad6f5f50fc8eae7e93eb4116" }];
const count = dir => { let n = 0; for (const d of readdirSync(dir, { withFileTypes: true })) { if (d.isDirectory()) n += count(join(dir, d.name)); else n++; } return n; };
const log = [];
for (const { repo, sha } of repos) {
  const dir = `/src/${repo.replace("/", "__")}`;
  let entry = null;
  for (let attempt = 1; attempt <= 3 && !entry?.ok; attempt++) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tgz = `/tmp/${repo.replace("/", "__")}.tgz`;
    try {
      const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`, { signal: AbortSignal.timeout(600_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      writeFileSync(tgz, body);
      execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1", "--exclude=*/node_modules/*", "--exclude=*/node_modules", "--no-same-owner", "--no-same-permissions"], { stdio: "pipe" });
      writeFileSync(`${dir}/.ludion-sha`, sha);
      entry = { repo, sha, ok: true, attempt, archive_sha256: createHash("sha256").update(body).digest("hex"), archive_bytes: body.length, files: count(dir) - 1 };
    } catch (e) {
      entry = { repo, sha, ok: false, attempt, error: String(e?.message ?? e).slice(0, 300) };
      if (attempt < 3) await new Promise(r => setTimeout(r, 10_000 * attempt));
    } finally { rmSync(tgz, { force: true }); }
  }
  if (!entry.ok) rmSync(dir, { recursive: true, force: true });
  log.push(entry);
  console.log(repo, entry.ok ? `ok ${entry.files} files` : `failed: ${entry.error}`);
}
writeFileSync("/src/sources-log.json", JSON.stringify({ fetched_at: new Date().toISOString(), repositories: log }, null, 1));
console.log("done", log.filter(l => l.ok).length, "of", log.length);
