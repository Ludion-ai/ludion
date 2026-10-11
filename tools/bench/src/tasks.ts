// Coding tasks for the realistic bench: a project overlay, the prompt, and a grader. Graders read the files the
// agent left; they never run them (the agent read untrusted text, so its code doesn't run on this machine).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Grade {
  verdict: "correct" | "wrong" | "unclear";
  why: string;
}

export interface Task {
  id: string;
  /** The prepared project (with node_modules) the overlay is copied onto. */
  project: string;
  overlay: string;
  prompt: string;
  grade(dir: string): Grade;
}

/** The text of the balanced bracket group that opens at `open` (inclusive), or "" if unbalanced. */
export function group(text: string, open: number): string {
  const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === "`") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) return "";
      i = end;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return text.slice(open, i + 1);
    }
  }
  return "";
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

/** The objects directly inside an array's text ("[ {...}, "./file.ts", {...} ]"). */
export function arrayObjects(array: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < array.length - 1; i++) {
    const c = array[i]!;
    if (c === "{") {
      const g = group(array, i);
      if (!g) break;
      out.push(g);
      i += g.length - 1;
    } else if (c === '"' || c === "'" || c === "`") i = array.indexOf(c, i + 1);
  }
  return out;
}

/** The inline project object whose name is `name`, or "". */
const projectNamed = (projects: string, name: string) =>
  arrayObjects(projects).find((p) => new RegExp(`name\\s*:\\s*["'\`]${name}["'\`]`).test(p)) ?? "";

/**
 * vitest 5 inline projects inherit the root config unless `extends: false` (vitest/dist/chunks, inheritsParentConfig).
 * Correct: the unit project can't get test/setup-db.ts: it has `extends: false`, or the root no longer lists the file.
 */
export function gradeVitestExtends(dir: string): Grade {
  const file = ["vitest.config.ts", "vitest.config.mts", "vitest.config.js"].map((f) => join(dir, f)).find(existsSync);
  if (!file) return { verdict: "unclear", why: "no vitest config" };
  const text = stripComments(readFileSync(file, "utf8"));
  const start = text.search(/projects\s*:\s*\[/);
  if (start < 0) return { verdict: "unclear", why: "no inline projects array" };
  const projects = group(text, text.indexOf("[", start));
  const unit = projectNamed(projects, "unit");
  if (!unit) return { verdict: "unclear", why: "no inline project named unit" };
  if (/extends\s*:\s*false/.test(unit)) return { verdict: "correct", why: "unit has extends: false" };
  if (/extends\s*:\s*["'`]/.test(unit)) return { verdict: "unclear", why: "unit extends another config file" };
  const root = text.replace(projects, "[]");
  if (/setup-db/.test(root)) return { verdict: "wrong", why: "unit inherits the root setupFiles (test/setup-db.ts)" };
  return { verdict: "correct", why: "the root no longer lists test/setup-db.ts" };
}

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export function vitestExtendsTask(projectsCache: string): Task {
  return {
    id: "vitest-extends",
    project: join(projectsCache, "vitest"),
    overlay: here("../tasks/vitest-extends/"),
    prompt:
      "Our unit tests in test/unit don't run yet. Add a project named unit to vitest.config.ts that runs test/unit/**/*.test.ts. The unit tests must not run test/setup-db.ts: it starts the test database, which needs Docker and takes about 20 seconds. Keep the integration project as it is. When you're done, say in one sentence how the unit project avoids the database setup.",
    grade: gradeVitestExtends,
  };
}
