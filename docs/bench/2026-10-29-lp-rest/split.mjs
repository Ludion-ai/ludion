// Moves every entry of docs/decisions.md and docs/progress.md into its own file, word for word, and writes each old
// file as an index (docs/decisions/2026-10-29-records-one-file-each.md). Then checks that the kept parts and the files,
// in the index's order, give the old file back byte for byte.
//   node split.mjs <repo> <old decisions.md> <old progress.md> <the commit they are from> <out dir for the report>
// The old files are read from copies (git show <commit>:docs/decisions.md), so a rerun after a merge of main starts
// from the merged text, not from an index this script wrote.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [repo, decisionsPath, progressPath, commit, out] = process.argv.slice(2);
if (!out) throw new Error("usage: node split.mjs <repo> <old decisions.md> <old progress.md> <commit> <out dir>");

// Undated sections take the date their heading was committed (git blame, recorded in the decision).
const UNDATED = { "## Carried over from v0": "2026-10-12", "## Done when (CLAUDE.md)": "2026-10-12", "## Current work: batch mode (from 2026-10-12)": "2026-10-12" };
const DATE = /^#{2,3} (\d{4}-\d{2}-\d{2})/;
const INTRO = "CLAUDE.md is the spec. This file holds";

/** The old file's lines cut into chunks: entries (go to files) and kept parts (stay in the index). */
function chunks(text) {
  if (!text.endsWith("\n")) throw new Error("expected a final newline");
  const lines = text.slice(0, -1).split("\n");
  const starts = lines.flatMap((l, i) => (/^#{1,2} /.test(l) || DATE.test(l) || l.startsWith(INTRO) ? [i] : []));
  if (starts[0] !== 0) throw new Error("the file does not start with a heading");
  return starts.map((s, k) => {
    const part = lines.slice(s, starts[k + 1] ?? lines.length), head = part[0];
    const empty = part.slice(1).every(l => !l.trim());
    const entry = /^## /.test(head) ? !empty : DATE.test(head);
    return { start: s + 1, end: s + part.length, lines: part, entry, head };
  });
}

function slug(text) {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (s.length <= 60) return s;
  const cut = s.slice(0, 61), at = cut.lastIndexOf("-");
  return (at > 0 ? cut.slice(0, at) : s.slice(0, 60)).replace(/-+$/, "");
}

/** The file name for an entry: date, (lane,) topic. */
function nameOf(head, kind) {
  const dated = DATE.exec(head);
  const date = dated ? dated[1] : UNDATED[head];
  if (!date) throw new Error(`no date for ${head}`);
  let rest = head.replace(/^#+ /, "");
  let paren = "";
  if (dated) {
    rest = rest.slice(date.length);
    const p = /^\s*\(([^)]*)\)/.exec(rest);
    if (p) { paren = p[1]; rest = rest.slice(p[0].length); }
    rest = rest.replace(/^\s*(:|—|-)\s*/, "");
  }
  const lane = /\b(L\d+|LS|LP)\b/.exec(paren)?.[1]?.toLowerCase() ?? "moved";
  return kind === "progress" ? `${date}-${lane}-${slug(rest)}` : `${date}-${slug(rest)}`;
}

function split(kind, path) {
  const old = readFileSync(path, "utf8"), dir = join(repo, "docs", kind);
  mkdirSync(dir, { recursive: true });
  const taken = new Set(existsSync(dir) ? readdirSync(dir) : []);
  const parts = chunks(old), index = [], files = [];
  const title = kind === "decisions" ? "Decisions" : "Progress";
  const what = kind === "decisions" ? "decision" : "result";
  const pattern = kind === "decisions" ? "YYYY-MM-DD-<topic>.md" : "YYYY-MM-DD-<lane>-<topic>.md";
  index.push(`# ${title}`, "",
    `One ${what} per file, in docs/${kind}/ (\`${pattern}\`). A new ${what} is a new file there; this file is not appended to (CLAUDE.md, "Engineering and security").`, "",
    `On 2026-10-29 every entry that was here moved, word for word, into its own file (docs/decisions/2026-10-29-records-one-file-each.md); the old text is this file at ${commit}. The list keeps the old order and the old headings, so a reference such as (docs/${kind}.md, "<title>") still finds its entry. Lines of the old file that were not entries are kept below as they were.`, "");
  for (const c of parts) {
    if (c.lines[0] === `# ${title}`) continue;
    if (!c.entry) {
      if (index.at(-1) !== "") index.push("");
      if (c.head.startsWith(INTRO)) index.push("The old file's introduction, whose rule docs/decisions/2026-10-29-records-one-file-each.md replaces:", "");
      index.push(...c.lines);
      continue;
    }
    let name = nameOf(c.head, kind), n = 1;
    while (taken.has(`${name}${n > 1 ? `-${n}` : ""}.md`)) n++;
    const file = `${name}${n > 1 ? `-${n}` : ""}.md`;
    taken.add(file);
    writeFileSync(join(dir, file), c.lines.join("\n") + "\n");
    c.file = file;
    files.push({ file, start: c.start, end: c.end, lines: c.lines.length });
    index.push(`- [${c.head.replace(/^#+ /, "").replace(/([\[\]])/g, "\\$1")}](${kind}/${file})`);
  }
  if (index.at(-1) !== "") index.push("");
  writeFileSync(join(repo, "docs", `${kind}.md`), index.join("\n"));

  // The check: kept parts and files, in order, give the old text back.
  const back = parts.map(c => (c.file ? readFileSync(join(dir, c.file), "utf8") : c.lines.join("\n") + "\n")).join("");
  const kept = parts.filter(c => !c.file).reduce((a, c) => a + c.lines.length, 0);
  const moved = files.reduce((a, f) => a + f.lines, 0);
  const oldLines = old.slice(0, -1).split("\n").length;
  return { kind, commit, old_lines: oldLines, old_bytes: Buffer.byteLength(old), files: files.length, moved_lines: moved, kept_lines: kept, lines_add_up: moved + kept === oldLines, byte_identical: back === old, list: files };
}

mkdirSync(out, { recursive: true });
const report = [split("decisions", decisionsPath), split("progress", progressPath)];
writeFileSync(join(out, "split-report.json"), JSON.stringify(report, null, 2) + "\n");
for (const r of report) console.log(`${r.kind}: ${r.files} files, old ${r.old_lines} lines = moved ${r.moved_lines} + kept ${r.kept_lines} (${r.lines_add_up}), byte-identical ${r.byte_identical}`);
if (!report.every(r => r.lines_add_up && r.byte_identical)) process.exit(1);
