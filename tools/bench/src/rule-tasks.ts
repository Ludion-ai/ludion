// C tasks: coding tasks graded by declarative rules on the files the agent leaves (docs/bench README "C tasks").
// A task lives in tools/bench/tasks-c/<id>/: task.json and files/ (copied over the prepared project). Rules only read
// files; nothing the agent wrote is ever run here (it read untrusted text).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { Grade } from "./tasks.ts";

export interface Rule {
  /** Candidate paths in the project; the first that exists is read. */
  files: string[];
  /** A JavaScript regular expression. */
  pattern: string;
  flags?: string;
  /** The rule holds when the pattern does NOT match (or no file exists). */
  absent?: boolean;
}

export interface RuleTask {
  id: string;
  /** The answer-key change it tests (docs/bench/2026-10-11-keys/keys.json). */
  change: string;
  library: "vitest" | "wrangler" | "agents";
  prompt: string;
  /** Alternatives: the task is correct when every rule of any one alternative holds. Otherwise it is wrong. */
  correct: Rule[][];
  /** Files a correct and a stale solution leave, to test the rules (path → content). */
  examples: { correct: Record<string, string>[]; wrong: Record<string, string>[] };
  /** Why the stale belief fails, in one sentence, for the README. */
  trap: string;
}

/**
 * `//` and `/* *\/` comments removed, string and template literals kept whole: a glob like 'src/**\/*.ts' or a URL
 * in a string must not be taken for a comment.
 */
export function stripJsComments(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && !(c !== "`" && text[j] === "\n")) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += text[i] ?? "";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  return out;
}

/** Comments are dropped before matching: an agent's comment may name the right symbol while the code doesn't. */
export function codeText(path: string, text: string): string {
  const ext = extname(path);
  if ([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsonc", ".tsx", ".jsx"].includes(ext) || path.endsWith("wrangler.json")) {
    return stripJsComments(text);
  }
  if (ext === ".toml" || ext === ".sh" || ext === ".yml" || ext === ".yaml") return text.replace(/(^|\s)#.*$/gm, "$1");
  return text;
}

function holds(rule: Rule, read: (path: string) => string | undefined): boolean {
  const path = rule.files.find((f) => read(f) !== undefined);
  if (path === undefined) return rule.absent === true;
  const matched = new RegExp(rule.pattern, rule.flags ?? "").test(codeText(path, read(path)!));
  return rule.absent ? !matched : matched;
}

export function gradeRules(task: Pick<RuleTask, "correct">, read: (path: string) => string | undefined): Grade {
  const ok = task.correct.findIndex((alt) => alt.every((r) => holds(r, read)));
  return ok >= 0 ? { verdict: "correct", why: `alternative ${ok + 1} holds` } : { verdict: "wrong", why: "no alternative holds" };
}

export const readFrom = (dir: string) => (path: string) => (existsSync(join(dir, path)) ? readFileSync(join(dir, path), "utf8") : undefined);

export function loadRuleTasks(tasksDir: string): (RuleTask & { overlay: string })[] {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(tasksDir, d.name, "task.json")))
    .map((d) => ({ ...(JSON.parse(readFileSync(join(tasksDir, d.name, "task.json"), "utf8")) as RuleTask), overlay: join(tasksDir, d.name, "files") }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
