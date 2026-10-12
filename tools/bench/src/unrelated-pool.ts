#!/usr/bin/env node
// Experiment 3's pool of unrelated lessons: lesson lines about packages the B questions aren't about, built from the
// seed pipeline's triage of 20 other packages (docs/bench/2026-10-12-subjects/). They are not verified lessons: each is
// a claim generated from a triaged changelog entry (package, first version, kind, symbol, signal), shown with the
// same teacher line as a seed, so the agent sees a file shaped like a project with many covered dependencies.
//   node tools/bench/src/unrelated-pool.ts <subjects dir> <out pool.json> [--exclude agents,vitest,wrangler]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { generateClaim, type LessonV1 } from "@ludion/core";
import type { Block } from "./unrelated.ts";

interface Verdict {
  id: string;
  candidate: boolean;
  kind?: LessonV1["kind"];
  signal?: "loud" | "silent";
  symbol?: string;
}

/** A symbol the claim can show: code-like, short, no backticks or angle brackets. */
const usable = (s: string | undefined): s is string => !!s && s.length <= 80 && !/[`<>\n]/.test(s);

export function blocksFor(pkg: string, installed: string, verdicts: Verdict[], date: string): Block[] {
  const out: Block[] = [];
  for (const v of verdicts) {
    if (!v.candidate || !v.kind || !v.signal || !usable(v.symbol) || v.kind === "renamed") continue;
    const version = v.id.split("#")[0]!;
    const claim = generateClaim({ package: { ecosystem: "npm", name: pkg }, versions: `>=${version}`, kind: v.kind, symbol: v.symbol, signal: v.signal } as LessonV1);
    out.push({ package: pkg, lines: [`- ${claim} (installed: ${pkg} ${installed})`, `  Taught by @Ludion-ai, drafted by an agent; verified by tests across versions on ${date}.`] });
  }
  return out;
}

/** Round-robin across packages, so the first N blocks of the pool come from many packages. */
export function interleave(groups: Block[][]): Block[] {
  const out: Block[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i++) for (const g of groups) if (i < g.length) out.push(g[i]!);
  return out;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { exclude: { type: "string", default: "agents,vitest,wrangler" } } });
  const [dir, out] = positionals;
  if (!dir || !out) throw new Error("Usage: node tools/bench/src/unrelated-pool.ts <subjects dir> <out pool.json>");
  const exclude = new Set(values.exclude!.split(","));
  const groups: Block[][] = [];
  for (const d of readdirSync(dir, { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => x.name).sort()) {
    const path = join(dir, d);
    if (!existsSync(join(path, "triage.json"))) continue;
    const run = JSON.parse(readFileSync(join(path, "run.json"), "utf8")) as { package: string; versions: string[] };
    if (exclude.has(run.package)) continue;
    const verdicts = JSON.parse(readFileSync(join(path, "triage.json"), "utf8")) as Verdict[];
    groups.push(blocksFor(run.package, run.versions.at(-1)!, verdicts, "2026-10-12"));
  }
  const pool = interleave(groups);
  writeFileSync(out, JSON.stringify(pool, null, 2) + "\n");
  console.log(`Pool: ${pool.length} blocks from ${groups.filter((g) => g.length).length} packages.`);
}
