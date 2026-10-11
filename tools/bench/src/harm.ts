// The harm check for seeds: lists every change where the run with `ludion sync` scored lower than the run without, on
// the B questions and the C tasks. A person then reads each one: if the change's own lesson caused the loss (it was in
// the synced file and the answer followed or stopped at it), that seed isn't published. Usage:
//   node tools/bench/src/harm.ts <out dir> [--without B-project,C-project] [--with B-project-sync,C-project-sync]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

/** Score per change: correct runs over runs. B grades end their id in -b, C rows carry their change. */
export function scores(file: { grades?: { id: string; grade: string }[]; rows?: { change: string; trial: number; verdict: string }[]; trials?: number }) {
  const out: Record<string, { correct: number; runs: number }> = {};
  const add = (change: string, ok: boolean) => {
    const s = (out[change] ??= { correct: 0, runs: 0 });
    s.runs++;
    if (ok) s.correct++;
  };
  for (const g of file.grades ?? []) add(g.id.replace(/-b$/, ""), g.grade === "correct");
  for (const r of file.rows ?? []) if (r.trial <= (file.trials ?? Infinity)) add(r.change, r.verdict === "correct");
  return out;
}

/** Changes measured both ways whose share of correct runs is lower with sync. */
export function losses(without: ReturnType<typeof scores>, withSync: ReturnType<typeof scores>) {
  return Object.entries(withSync).flatMap(([change, w]) => {
    const wo = without[change];
    return wo && w.correct / w.runs < wo.correct / wo.runs ? [{ change, without: wo, with: w }] : [];
  });
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { without: { type: "string", default: "B-project,C-project" }, with: { type: "string", default: "B-project-sync,C-project-sync" } },
  });
  const [dir] = positionals;
  if (!dir) {
    console.error("Usage: node tools/bench/src/harm.ts <out dir> [--without B-project,C-project] [--with B-project-sync,C-project-sync]");
    process.exit(2);
  }
  const load = (labels: string) => {
    const all: ReturnType<typeof scores> = {};
    for (const label of labels.split(",")) {
      for (const file of [`grades-${label}.json`, `tasks-${label}.json`]) {
        if (!existsSync(join(dir, file))) continue;
        // B and C are kept apart: a change can have both a question and a task.
        for (const [change, s] of Object.entries(scores(JSON.parse(readFileSync(join(dir, file), "utf8"))))) all[`${label.split("-")[0]} ${change}`] = s;
      }
    }
    return all;
  };
  const found = losses(load(values.without!), load(values.with!));
  for (const l of found) console.log(`${l.change}: without ${l.without.correct}/${l.without.runs}, with sync ${l.with.correct}/${l.with.runs}`);
  console.log(`${found.length} losses with sync. Read each one: did the change's own lesson cause it?`);
}

if (import.meta.main) main();
