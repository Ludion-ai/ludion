// LDGLAT: extract, from a blobless clone of docker-library/repo-info, each counted file's
// commits and the dpkg source packages each listing has. Runs only in a container with no
// credentials (README). Usage: node extract.mjs <repo-info dir> <out dir>
// Writes commits.tsv (file, commit, commit time, image id, created, number of source packages)
// and packages.tsv (file, commit, commit time, source, version, first binary).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const [repo, out] = process.argv.slice(2);
const FILES = [
  "repos/debian/local/bookworm-slim.md",
  "repos/debian/local/bookworm.md",
  "repos/buildpack-deps/local/bookworm.md",
  "repos/node/local/22-bookworm-slim.md",
  "repos/node/local/24-bookworm-slim.md",
  "repos/node/local/22-bookworm.md",
  "repos/node/local/24-bookworm.md",
  "repos/php/local/8.2-cli-bookworm.md",
  "repos/php/local/8.3-cli-bookworm.md",
  "repos/php/local/8.4-cli-bookworm.md",
  "repos/php/local/8.4-fpm-bookworm.md",
  "repos/php/local/8.4-apache-bookworm.md",
  "repos/php/local/8.5-cli-bookworm.md",
];
// Commits from this time on, and the one before it (the listing in effect then).
const FROM = Date.parse("2025-09-01T00:00:00Z") / 1000;

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });
const iso = (t) => new Date(t * 1000).toISOString().replace(".000Z", "Z");

const commits = ["file\tcommit\tcommit_time\timage_id\tcreated\tn_src"];
const packages = ["file\tcommit\tcommit_time\tsource\tversion\tfirst_binary"];
const SRC = /^### `dpkg` source package: `([^=`]+)=([^`]+)`$/;
const BIN = /^- `([^:=`]+)(?::[a-z0-9]+)?=([^`]+)`$/;

for (const file of FILES) {
  const log = git("log", "--format=%H %ct", "--", file).trim().split("\n").filter(Boolean).map((l) => {
    const [sha, t] = l.split(" ");
    return { sha, t: Number(t) };
  });
  const keep = [];
  for (const c of log) { // newest first
    if (c.t >= FROM) keep.push(c);
    else { keep.push(c); break; }
  }
  process.stderr.write(`${file}: ${log.length} commits, ${keep.length} read\n`);
  for (const c of keep.reverse()) {
    let text;
    try { text = git("show", `${c.sha}:${file}`); } catch { text = null; }
    if (text === null) { commits.push([file, c.sha, iso(c.t), "MISSING", "", 0].join("\t")); continue; }
    const lines = text.split("\n");
    const id = (lines.find((l) => l.startsWith("- Image ID: ")) || "").replace(/^- Image ID: `?|`$/g, "") || "NONE";
    const created = (lines.find((l) => l.startsWith("- Created: ")) || "").replace(/^- Created: `?|`$/g, "");
    let n = 0, cur = null, inBin = false;
    for (const l of lines) {
      const m = SRC.exec(l);
      if (m) { if (cur) packages.push(cur.join("\t")); cur = [file, c.sha, iso(c.t), m[1], m[2], ""]; n++; inBin = false; continue; }
      if (cur && l === "Binary Packages:") { inBin = true; continue; }
      if (cur && inBin && cur[5] === "") { const b = BIN.exec(l); if (b) { cur[5] = b[1]; inBin = false; } }
    }
    if (cur) packages.push(cur.join("\t"));
    commits.push([file, c.sha, iso(c.t), id, created, n].join("\t"));
  }
}
writeFileSync(`${out}/commits.tsv`, commits.join("\n") + "\n");
writeFileSync(`${out}/packages.tsv`, packages.join("\n") + "\n");
process.stderr.write(`done ${commits.length - 1} commits, ${packages.length - 1} package rows\n`);
