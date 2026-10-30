// The records the way of working depends on (CLAUDE.md, How we work; docs/decisions/2026-10-29-way-of-working.md):
// every mistake in docs/mistakes/ points to a check that exists or a rule CLAUDE.md still says, CLAUDE.md opens with
// the goal and stays small, and the rule on deleted files names the same places in CLAUDE.md and the workflow.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const isFile = (path: string) => { try { return statSync(new URL(path, root)).isFile(); } catch { return false; } };

/** What is wrong with one mistake record, given the text of CLAUDE.md. Empty when nothing is. */
function problems(name: string, text: string, claude: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)) out.push(`file name: ${name}`);
  if (!/^- \*\*What happened\.\*\* \S/m.test(text)) out.push("no What happened");
  if (!/^- \*\*Why\.\*\*/m.test(text)) out.push("no Why");
  let pointers = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("- **Check:**")) {
      const path = /^- \*\*Check:\*\* `([^`]+)`/.exec(line)?.[1];
      if (!path) out.push(`unreadable check: ${line}`);
      else if (path.startsWith("/") || path.split("/").includes("..") || !isFile(path)) out.push(`check does not exist: ${path}`);
      else pointers++;
    } else if (line.startsWith("- **Rule:**")) {
      const rule = /^- \*\*Rule:\*\* "(.+)"\s*$/.exec(line)?.[1];
      if (!rule) out.push(`unreadable rule: ${line}`);
      else if (!flat(claude).includes(flat(rule))) out.push(`CLAUDE.md no longer says: ${rule}`);
      else pointers++;
    }
  }
  if (!pointers) out.push("no check or rule");
  return out;
}

describe("docs/mistakes/", () => {
  const claude = read("CLAUDE.md");
  const names = readdirSync(new URL("docs/mistakes/", root)).filter(n => n.endsWith(".md"));

  it("has records, and every one names a check that exists or a rule CLAUDE.md still says", () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect([name, problems(name, read(`docs/mistakes/${name}`), claude)]).toEqual([name, []]);
  });

  it("fails a record whose check is gone, whose rule CLAUDE.md dropped, or that points at nothing", () => {
    const record = (...lines: string[]) => ["# x", "", "- **What happened.** x", "- **Why.** x", ...lines].join("\n");
    expect(problems("2026-10-29-x.md", record("- **Check:** `tools/records/test/gone.test.ts` — x"), claude)).toEqual(["check does not exist: tools/records/test/gone.test.ts", "no check or rule"]);
    expect(problems("2026-10-29-x.md", record("- **Check:** `../CLAUDE.md`"), claude)).toEqual(["check does not exist: ../CLAUDE.md", "no check or rule"]);
    expect(problems("2026-10-29-x.md", record('- **Rule:** "Agents may merge anything."'), claude)).toEqual(["CLAUDE.md no longer says: Agents may merge anything.", "no check or rule"]);
    expect(problems("2026-10-29-x.md", record("- **Check:** tools/records/test/records.test.ts"), claude)).toEqual(["unreadable check: - **Check:** tools/records/test/records.test.ts", "no check or rule"]);
    expect(problems("2026-10-29-x.md", record(), claude)).toEqual(["no check or rule"]);
    expect(problems("notes.md", "", claude)).toEqual(["file name: notes.md", "no What happened", "no Why", "no check or rule"]);
    // A rule is matched across line breaks and repeated spaces, not only as one line.
    expect(problems("2026-10-29-x.md", record('- **Rule:** "Never push   directly to main."'), claude)).toEqual([]);
  });
});

describe("CLAUDE.md", () => {
  const claude = read("CLAUDE.md");

  it("opens with the goal, which says nothing is released until complete", () => {
    expect(claude.startsWith("# Ludion\n\n## Goal\n")).toBe(true);
    const goal = claude.slice(0, claude.indexOf("\n## ", 12));
    expect(goal).toContain("**No release until complete**");
  });

  it("stays under 12,000 bytes: what is built goes in docs/status.md", () => {
    expect(Buffer.byteLength(claude)).toBeLessThan(12_000);
    expect(isFile("docs/status.md")).toBe(true);
  });
});

describe("the rule on deleted files", () => {
  const places = (pattern: string) => pattern.split("|").map(p => p.replace(/^\^/, "").replace(/\$$/, "").replace("[^/]+", "*").replace(/\\\./g, ".")).sort();
  const workflow = read(".github/workflows/protected-paths.yml");
  const pattern = /^\s+REMOVED: '([^']+)'$/m.exec(workflow)?.[1] ?? "";

  it("names the same places in protected-paths.yml, CLAUDE.md and docs/protected-paths.md", () => {
    const sentence = /A PR that deletes(.+?) is a protected PR/.exec(read("CLAUDE.md"))?.[1] ?? "";
    const named = (sentence.match(/[a-z][a-z0-9._*-]*(?:\/[a-z0-9._*-]+)*\/|action\.yml/g) ?? []).sort();
    expect(places(pattern)).toEqual(["action.yml", "action/", "apps/site/src/pages/", "docs/decisions/", "docs/mistakes/", "packages/*/src/"]);
    expect(named).toEqual(places(pattern));
    const doc = read("docs/protected-paths.md");
    for (const place of places(pattern)) expect(doc).toContain(`\`${place}\``);
  });

  it("matches a deleted source file, page or record, and not a test, a doc or the status file", () => {
    const re = new RegExp(pattern);
    for (const path of ["packages/cli/src/security/php.ts", "packages/sandbox/src/index.ts", "apps/site/src/pages/start.astro", "action/judge.sh", "action.yml", "docs/decisions/2026-10-29-x.md", "docs/mistakes/2026-10-29-x.md"]) expect([path, re.test(path)]).toEqual([path, true]);
    for (const path of ["packages/cli/test/php.test.ts", "apps/site/src/components/Hero.astro", "docs/status.md", "docs/progress/2026-10-29-x.md", "action.yml.bak", "x/packages/cli/src/a.ts"]) expect([path, re.test(path)]).toEqual([path, false]);
  });

  it("is read from the PR's files with removed and renamed-out entries, and makes the PR protected", () => {
    expect(workflow).toContain('select(.status == "removed" or (.status == "renamed" and (.filename | test(env.REMOVED) | not)))');
    expect(workflow).toContain('(.previous_filename // .filename) | select(test(env.REMOVED))');
    expect(workflow).toContain(`printf '%s\\n' "$deleted"`);
  });
});

describe("the rule on recording a review", () => {
  // What CLAUDE.md and docs/protected-paths.md say about it, word for word. Posting adds a footer after the review,
  // so a review has the line rather than ends with it (docs/decisions/2026-10-30-reviewed-sha-has-the-line.md).
  const RULE = "Every review, protected path or not, is posted on its PR as a comment that has the line `reviewed-sha: <the head SHA reviewed>`; a review with no such record on GitHub is never reported as a review.";
  const STEP_1 = "1. A reviewer other than the author, with fresh context, reads the full diff at the current head and posts the review as a PR comment. Its first line states the verdict (`APPROVE` or `REQUEST CHANGES`), and it has the line `reviewed-sha: <head SHA it reviewed>`, which need not be its last line.";
  const EVERY = "Every review, of a protected PR or not and whatever its verdict, is posted as a comment on that PR and has the line `reviewed-sha: <the head SHA it reviewed>`. That line is, in full, `reviewed-sha:`, one space and the 40-character SHA in lowercase, with nothing before or after it; a line in any other form is not counted. A comment with exactly one such line is a review of the head it names. A comment with two or more, as when it quotes another review's line, is not counted as a review: it approves nothing, and it undoes an earlier approval of each head it names. A review made after a merge is posted on the merged PR. A review with no such comment on GitHub is never reported as a review.";
  const CHECK = "A comment approves when its first line has the word `APPROVE` and not `REQUEST`, and it has exactly one `reviewed-sha:` line (below).";
  const SAYS = { "CLAUDE.md": [RULE], "docs/protected-paths.md": [CHECK, STEP_1, EVERY] };
  type Path = keyof typeof SAYS;
  const missing = (path: Path, text: string) => SAYS[path].filter(sentence => !flat(text).includes(flat(sentence)));
  const swap = (text: string, from: string, to: string) => { expect(text).toContain(from); return text.split(from).join(to); };

  it("says a review has the line reviewed-sha: in CLAUDE.md and in docs/protected-paths.md alike", () => {
    for (const path of ["CLAUDE.md", "docs/protected-paths.md"] as const) expect([path, missing(path, read(path))]).toEqual([path, []]);
  });

  it("fails a file that goes back to a review ending with the line, or makes it the last line again", () => {
    const claude = read("CLAUDE.md"), doc = read("docs/protected-paths.md");
    const changes: [Path, string, string, string][] = [
      ["CLAUDE.md", "is posted on its PR as a comment that has the line", "is posted as a comment on its PR ending", RULE],
      ["CLAUDE.md", "`reviewed-sha: <the head SHA reviewed>`;", "`reviewed-sha: <the head SHA reviewed>` as its last line;", RULE],
      ["docs/protected-paths.md", "and it has the line `reviewed-sha: <head SHA it reviewed>`, which need not be its last line.", "and its last line is `reviewed-sha: <head SHA it reviewed>`.", STEP_1],
      ["docs/protected-paths.md", ", which need not be its last line.", " as its last line.", STEP_1],
      ["docs/protected-paths.md", ", which need not be its last line.", ", and nothing after it.", STEP_1],
      ["docs/protected-paths.md", "on that PR and has the line", "on that PR and ends with the line", EVERY],
      ["docs/protected-paths.md", "`reviewed-sha: <the head SHA it reviewed>`. That line", "`reviewed-sha: <the head SHA it reviewed>` as its last line. That line", EVERY],
      ["docs/protected-paths.md", "on that PR and has the line", "on that PR and usually has the line", EVERY],
      ["docs/protected-paths.md", "and it has exactly one `reviewed-sha:` line", "and it has a `reviewed-sha:` line", CHECK],
      ["docs/protected-paths.md", "A comment with exactly one such line", "A comment with at least one such line", EVERY],
    ];
    for (const [path, from, to, lost] of changes) expect([to, missing(path, swap(path === "CLAUDE.md" ? claude : doc, from, to))]).toEqual([to, [lost]]);
  });
});

describe("test.yml", () => {
  it("fails a PR whose base is not main, before anything else runs", () => {
    const yml = read(".github/workflows/test.yml");
    const steps = yml.slice(yml.indexOf("    steps:\n"));
    const start = steps.indexOf("\n      - ");
    const first = steps.slice(start, steps.indexOf("\n      - ", start + 1));
    expect(first).toContain("name: The PR targets main");
    expect(first).toContain("BASE: ${{ github.base_ref }}");
    expect(first).toContain('if [ "$BASE" != "main" ]; then');
    expect(first).toContain("exit 1");
  });
});
