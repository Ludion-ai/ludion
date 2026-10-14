// This is an explorable example of the current public index, not a replay of the older demo's sync output.
// Use the CLI's actual range matching and measured-model pruning; never infer knowledge from a missing result.
import type { Index, IndexEntry } from "@ludion/core";
import { matchingVersions, select, type SyncLesson } from "../../../../packages/cli/src/match.ts";
import type { Models, Verdict } from "./models.ts";

export const LENS_PROJECTS = [
  { id: "vitest-5", name: "vitest", version: "5.0.3" }, // tools/bench/projects/vitest/package.json
  { id: "vitest-4", name: "vitest", version: "4.0.0" }, // docs/demo/README.md, second project
  { id: "wrangler-current", name: "wrangler", version: "4.148.0" }, // tools/bench/projects/wrangler/package.json
  { id: "wrangler-earlier", name: "wrangler", version: "4.113.0" }, // exact differential evidence pin
] as const;

export interface LensLesson {
  entry: IndexEntry;
  verdict: Verdict | null;
  included: boolean;
}

export interface LensCase {
  project: (typeof LENS_PROJECTS)[number];
  model: string;
  total: number;
  matched: number;
  included: number;
  pruned: number;
  unmeasured: number;
  /** A small labeled preview; the counts above describe the entire matching set, not just these rows. */
  preview: LensLesson[];
}

const priority = ["extends", "vi.restoreAllMocks", "vitest.config", "nodejs_compat", "deploy", "DO_NOT_TRACK"];

export function projectLens(index: Index, models: Models | null) {
  const modelOptions = Object.entries(models?.models ?? {}).map(([id, model]) => ({ id, name: model.name }));
  // With no benchmark available, the CLI applies no model filter. Missing verdicts stay included.
  if (!modelOptions.length) modelOptions.push({ id: "", name: "" });
  // The measured Haiku example visibly leaves out its known Vitest config lesson; all counts remain index-derived.
  const defaultModel = modelOptions.find((model) => model.id === "claude-haiku-5-5")?.id ?? modelOptions[0]!.id;
  const entries = index.lessons.filter((entry) => entry.format === 1 && entry.package?.ecosystem === "npm" && entry.version);
  const cases: LensCase[] = [];
  for (const project of LENS_PROJECTS) {
    const packageEntries = entries.filter((entry) => entry.package!.name === project.name);
    const installed = { npm: new Map([[project.name, new Set([project.version])]]), node: "24", source: "example" };
    const lessons: SyncLesson[] = packageEntries.map((entry) => ({
      id: entry.id,
      package: entry.package!,
      versions: entry.version!,
      claim: entry.claim,
      signal: entry.signal,
      kind: entry.kind,
      teacher: `@${entry.teacher}`,
      verified: entry.verified_by,
      drafted_by: entry.drafted_by,
      models: models?.lessons[entry.id],
      origin: "index",
    }));
    for (const model of modelOptions) {
      const selection = select(lessons, installed, model.id || undefined);
      const included = new Set(selection.kept.map(({ lesson }) => lesson.id));
      const matched = packageEntries
        .filter((_, i) => matchingVersions(lessons[i]!, installed).length > 0)
        .map((entry): LensLesson => ({ entry, verdict: models?.lessons[entry.id]?.[model.id] ?? null, included: included.has(entry.id) }));
      matched.sort((a, b) => {
        const aPriority = priority.indexOf(a.entry.symbol ?? "");
        const bPriority = priority.indexOf(b.entry.symbol ?? "");
        return (aPriority < 0 ? priority.length : aPriority) - (bPriority < 0 ? priority.length : bPriority)
          || a.entry.id.localeCompare(b.entry.id);
      });
      cases.push({
        project, model: model.id, total: packageEntries.length, matched: matched.length,
        included: selection.kept.length, pruned: selection.prunedForModel.length,
        unmeasured: matched.filter((lesson) => lesson.verdict === null).length,
        preview: matched.slice(0, 3),
      });
    }
  }
  return { cases, models: modelOptions, defaultProject: LENS_PROJECTS[0].id, defaultModel, measuredAt: models?.measured_at ?? null };
}
