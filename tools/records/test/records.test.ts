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
