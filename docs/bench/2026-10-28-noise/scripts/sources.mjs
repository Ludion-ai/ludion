// For the reviewers: each included repository's source at the recorded SHA, from GitHub's archive, extracted (never run)
// into /src/<owner>__<repo>. node_modules folders inside the archive are left out.
import { readFileSync, mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
const run = JSON.parse(readFileSync("/out/noise.json", "utf8"));
const log = [];
for (const r of run.rows) {
  const dir = `/src/${r.repo.replace("/", "__")}`;
  if (existsSync(`${dir}/.ludion-sha`) && readFileSync(`${dir}/.ludion-sha`, "utf8") === r.sha) { log.push({ repo: r.repo, status: "cached" }); continue; }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const res = await fetch(`https://codeload.github.com/${r.repo}/tar.gz/${r.sha}`);
  if (!res.ok) { log.push({ repo: r.repo, status: `HTTP ${res.status}` }); continue; }
  const tgz = `/tmp/${r.repo.replace("/", "__")}.tgz`;
  writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  try {
    execFileSync("tar", ["-xzf", tgz, "-C", dir, "--strip-components=1", "--exclude=*/node_modules/*", "--no-same-owner", "--no-same-permissions"]);
    writeFileSync(`${dir}/.ludion-sha`, r.sha);
    log.push({ repo: r.repo, status: "ok" });
  } catch (e) { log.push({ repo: r.repo, status: `tar failed: ${String(e).slice(0, 200)}` }); }
  rmSync(tgz, { force: true });
  console.log(r.repo, log.at(-1).status);
}
writeFileSync("/src/sources-log.json", JSON.stringify(log, null, 1));
