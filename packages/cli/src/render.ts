// .ludion/lessons.md, and the lines that wire it into CLAUDE.md, AGENTS.md, and Cursor rules.
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { COVERAGE_LINE, EVIDENCE_SCOPE, LESSON_DATA_LINE, evidenceLabel, type VerifiedBy } from "@ludion/core";
import { UNVERIFIED } from "./ledger.ts";
import type { Selection } from "./match.ts";

/** The first line of everything Ludion hands an assistant (the same line ludion_ask starts with). */
export const DATA_LINE = LESSON_DATA_LINE;

const BEGIN = "<!-- ludion: begin (written by ludion sync) -->";
const END = "<!-- ludion: end -->";

function teacherLine(l: Selection["kept"][number]["lesson"]): string {
  const who = l.teacher === "you" ? "Taught by you (in your ledger, not public)" : `Taught by ${l.teacher}`;
  const drafted = l.drafted_by === "agent" ? ", drafted by an agent" : "";
  const [by, ...rest] = l.verified.split(" ");
  const known = ["test", "differential", "proof", "source"].includes(by!);
  const label = known ? `${evidenceLabel(by as VerifiedBy)}${rest.length ? ` ${rest.join(" ")}` : ""}` : l.verified;
  const verified = l.verified.startsWith("not verified") || l.verified === UNVERIFIED ? l.verified : `evidence checked: ${label}${l.verified_at ? ` on ${l.verified_at.slice(0, 10)}` : ""}`;
  return `${who}${drafted}; ${verified}.${l.url ? ` ${l.url}` : ""}`;
}

/** At most this many uncovered dependencies are named in lessons.md; the rest are counted. */
const UNCOVERED_SHOWN = 40;

/**
 * lessons.md. `uncovered`: the project's direct dependencies Ludion has no subject for, named so the assistant knows
 * to check them elsewhere (undefined when the index couldn't be read, so it isn't known).
 */
export function renderLessons(selection: Selection, installedSummary: string, now: Date, uncovered?: string[]): string {
  const lines = [
    "# Lessons from Ludion",
    "",
    DATA_LINE,
    "",
    COVERAGE_LINE,
    "",
    EVIDENCE_SCOPE,
    "",
    `Changes in the versions this project installed (${installedSummary}) that your model may not know. Written by \`ludion sync\` on ${now.toISOString().slice(0, 10)}; don't edit by hand.`,
    "",
  ];
  if (selection.kept.length === 0) {
    lines.push("No lesson matches this project's versions yet.");
  } else {
    for (const { lesson, versions } of selection.kept) {
      lines.push(`- ${lesson.claim} (installed: ${lesson.package.name} ${versions.join(", ")})`);
      lines.push(`  ${teacherLine(lesson)}`);
    }
  }
  if (uncovered?.length) {
    const named = uncovered.slice(0, UNCOVERED_SHOWN).join(", ");
    const more = uncovered.length > UNCOVERED_SHOWN ? ` and ${uncovered.length - UNCOVERED_SHOWN} more` : "";
    lines.push("", `Ludion has no lessons at all for these dependencies: ${named}${more}.`);
  }
  return lines.join("\n") + "\n";
}

/** The lessons in a lessons.md, without the header lines that change on every sync (date, installed summary). */
export function lessonLines(md: string): string {
  return md.split("\n").filter((l) => l.startsWith("- ") || l.startsWith("  ")).join("\n");
}

/** The current .ludion/lessons.md if it is a regular file, else "". */
export function readLessonsFile(dir: string): string {
  const path = join(dir, ".ludion", "lessons.md");
  return lstatSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, "utf8") : "";
}

/** Replace the block between the markers, or append it. Returns the new text. */
export function withBlock(text: string, block: string): string {
  const full = `${BEGIN}\n${block}\n${END}`;
  const start = text.indexOf(BEGIN);
  const end = start >= 0 ? text.indexOf(END, start + BEGIN.length) : -1;
  if (start >= 0 && end > start) return text.slice(0, start) + full + text.slice(end + END.length);
  return (text.length && !text.endsWith("\n") ? `${text}\n` : text) + (text.length ? "\n" : "") + full + "\n";
}

/**
 * Write a file inside the project, and only inside it. Sync runs on its own (a session-start hook) in projects
 * someone else may have prepared, so a symlinked target or parent could point the write anywhere: refuse those.
 */
export function safeWrite(dir: string, rel: string, text: string): void {
  const root = realpathSync(dir);
  const target = join(root, rel);
  // lstat, never existsSync: existsSync follows links, so a dangling link would look like a missing file.
  const isLink = (p: string) => lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;
  for (let p = dirname(target); p.length > root.length; p = dirname(p)) {
    if (isLink(p)) throw new Error(`${relative(root, p)} is a symbolic link; ludion writes only real files inside the project. Remove the link and sync again.`);
  }
  mkdirSync(dirname(target), { recursive: true });
  const parent = realpathSync(dirname(target));
  const inside = relative(root, parent);
  if (inside.startsWith("..") || isAbsolute(inside)) throw new Error(`${rel} would be written outside the project. Sync refused.`);
  if (isLink(target)) throw new Error(`${rel} is a symbolic link; ludion writes only real files inside the project. Remove the link and sync again.`);
  // Write a temporary file in the checked folder and rename it over the target: a rename replaces a link that
  // appeared in the meantime instead of following it.
  const tmp = join(parent, `.${basename(target)}.ludion-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, text, { flag: "wx" });
  renameSync(tmp, join(parent, basename(target)));
}

export interface WireResult {
  written: string[];
  /** Files left alone, with why: a link, or not a regular file. Sync goes on without them. */
  skipped: string[];
}

class Skip extends Error {}

/** Read a wiring file only if it is a regular file; missing → "". A link or a folder is skipped, not fatal. */
function readWiring(path: string, name: string): string {
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st) return "";
  if (st.isSymbolicLink()) throw new Skip(`${name} is a symbolic link; left as it is (point it at a real file to let sync wire it).`);
  if (!st.isFile()) throw new Skip(`${name} is not a regular file; left as it is.`);
  return readFileSync(path, "utf8");
}

/**
 * Write .ludion/lessons.md and point the project's assistant instructions at it:
 * CLAUDE.md (created if missing) imports it; AGENTS.md, if present, names it; Cursor, if .cursor/ exists, gets a rule
 * with the lessons inline (Cursor rules can't include other files). A file that is a link or not a regular file is
 * skipped with a reason: sync runs at session start and must not fail the session over a project's layout.
 */
export function writeAndWire(dir: string, lessonsMd: string, opts: { privateLessons?: boolean } = {}): WireResult {
  const written: string[] = [];
  const skipped: string[] = [];
  const step = (fn: () => string | undefined) => {
    try {
      const w = fn();
      if (w) written.push(w);
    } catch (err) {
      if (err instanceof Skip || /is a symbolic link|outside the project/.test((err as Error).message)) skipped.push((err as Error).message);
      else throw err;
    }
  };

  if (opts.privateLessons) {
    const generated = [".ludion/lessons.md", ".cursor/rules/ludion.mdc"];
    // A SessionStart hook must not place personal corrections into a file already queued for version control.
    // Disable fsmonitor: reading a repository's index must not execute a repository-configured helper.
    const git = spawnSync("git", ["-c", "core.fsmonitor=false", "-C", dir, "ls-files", "--", ...generated.map((p) => `:(icase,literal)${p}`)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 });
    if (git.status === 0 && git.stdout.trim()) return { written, skipped: ["A generated lessons file is tracked by Git. Personal ledger lessons were not written; untrack the generated files before syncing private lessons."] };
    let repository = false;
    for (let p = realpathSync(dir); ; p = dirname(p)) {
      if (lstatSync(join(p, ".git"), { throwIfNoEntry: false })) { repository = true; break; }
      if (dirname(p) === p) break;
    }
    if ((git.status !== 0 && repository) || (git.error && (git.error as NodeJS.ErrnoException).code !== "ENOENT")) return { written, skipped: ["Could not check whether generated files are tracked. Personal ledger lessons were not written."] };
    step(() => {
      const text = readWiring(join(dir, ".gitignore"), ".gitignore");
      const block = "# ludion: local personal lessons\n/.ludion/\n/.cursor/rules/ludion.mdc\n";
      if (!text.endsWith(block)) safeWrite(dir, ".gitignore", `${text}${text && !text.endsWith("\n") ? "\n" : ""}${block}`);
      return ".gitignore";
    });
    if (!written.includes(".gitignore")) return { written, skipped };
    if (git.status === 0) {
      for (const path of generated) {
        const ignored = spawnSync("git", ["-c", "core.fsmonitor=false", "-C", dir, "check-ignore", "--quiet", "--", path], { stdio: "ignore", timeout: 2000 });
        if (ignored.status !== 0) return { written, skipped: [...skipped, "Git does not ignore a generated lessons file. Personal ledger lessons were not written."] };
      }
    }
  }

  step(() => (safeWrite(dir, join(".ludion", "lessons.md"), lessonsMd), ".ludion/lessons.md"));
  if (!written.includes(".ludion/lessons.md")) return { written, skipped };

  step(() => {
    const text = readWiring(join(dir, "CLAUDE.md"), "CLAUDE.md");
    const next = withBlock(text, "@.ludion/lessons.md");
    if (next === text) return undefined;
    safeWrite(dir, "CLAUDE.md", next);
    return "CLAUDE.md";
  });

  if (lstatSync(join(dir, "AGENTS.md"), { throwIfNoEntry: false })) {
    step(() => {
      const text = readWiring(join(dir, "AGENTS.md"), "AGENTS.md");
      const next = withBlock(text, "Before writing code that uses this project's packages, read `.ludion/lessons.md`: changes in the installed versions that you may not know.");
      if (next === text) return undefined;
      safeWrite(dir, "AGENTS.md", next);
      return "AGENTS.md";
    });
  }

  if (lstatSync(join(dir, ".cursor"), { throwIfNoEntry: false })) {
    step(() => {
      safeWrite(dir, join(".cursor", "rules", "ludion.mdc"), `---\ndescription: Changes in this project's installed package versions (written by ludion sync)\nalwaysApply: true\n---\n\n${lessonsMd}`);
      return ".cursor/rules/ludion.mdc";
    });
  }
  return { written, skipped };
}
