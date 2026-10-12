// Experiment 3: does a long lessons file hurt? Adds N lessons about packages the question isn't about to the
// .ludion/lessons.md that `ludion sync` wrote, in the order sync itself uses (by package name), so the lessons that
// matter sit among the others as they would in a project with many covered dependencies.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** One lesson as lessons.md shows it: the claim line and the teacher line. */
export interface Block {
  package: string;
  lines: [string, string];
}

/** The lesson blocks in a lessons.md, and the text around them. */
export function splitLessons(md: string): { head: string[]; blocks: Block[]; tail: string[] } {
  const lines = md.replace(/\n$/, "").split("\n");
  const first = lines.findIndex((l) => l.startsWith("- "));
  if (first < 0) return { head: lines, blocks: [], tail: [] };
  const blocks: Block[] = [];
  let i = first;
  while (i < lines.length && lines[i]!.startsWith("- ")) {
    const pkg = /\(installed: (\S+) /.exec(lines[i]!)?.[1] ?? "";
    blocks.push({ package: pkg, lines: [lines[i]!, lines[i + 1] ?? ""] });
    i += 2;
  }
  return { head: lines.slice(0, first), blocks, tail: lines.slice(i) };
}

/** sync's order (packages/cli/src/match.ts, rank): silent changes, then loud ones, then additions; read from the claim. */
export function rankOf(b: Block): number {
  if (b.lines[0].includes("Older versions don't have it.")) return 2;
  return b.lines[0].includes("Silent: code written for older versions still runs") ? 0 : 1;
}

/** lessons.md with `extra` blocks merged in, in sync's order: by rank, then package name (stable within a package). */
export function withUnrelated(md: string, extra: Block[]): string {
  const { head, blocks, tail } = splitLessons(md);
  if (extra.length === 0) return md;
  const all = [...blocks, ...extra].map((b, i) => ({ b, i })).sort((x, y) => rankOf(x.b) - rankOf(y.b) || x.b.package.localeCompare(y.b.package) || x.i - y.i);
  return [...head, ...all.flatMap(({ b }) => b.lines), ...tail].join("\n") + "\n";
}

/** Add the first `count` blocks of a pool file (a JSON array of Block) to the lessons.md in `work`. */
export function addUnrelated(work: string, poolPath: string, count: number): void {
  const pool = JSON.parse(readFileSync(poolPath, "utf8")) as Block[];
  if (pool.length < count) throw new Error(`The pool has ${pool.length} lessons; ${count} were asked for.`);
  const path = join(work, ".ludion", "lessons.md");
  writeFileSync(path, withUnrelated(readFileSync(path, "utf8"), pool.slice(0, count)));
}
