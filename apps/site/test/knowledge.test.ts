// The knowledge strips, dates, and lesson list on /bench: every square and dot is a models.json verdict, and every
// date is the npm registry's, as committed in docs/bench/release-dates.json.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import { describe, expect, it } from "vitest";
import type { Index } from "@ludion/core";
import { dateAxis, firstSentence, knowledge, readReleaseDates } from "../src/build/knowledge.ts";
import { readModels, type Models } from "../src/build/models.ts";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const models = readModels(root)!;
const dates = readReleaseDates(root)!;

const entry = (id: string, subject: string, version: string, extra: object = {}) =>
  ({ id, subject, version, claim: `${subject} ${version} changed what \`a.b\` does. More.`, package: { ecosystem: "npm", name: subject }, kind: "behavior", signal: "silent", ...extra }) as unknown as Index["lessons"][number];

describe("firstSentence", () => {
  it("ends at the first period outside a code span", () => {
    expect(firstSentence("wrangler >=4.1.0 changed what `x. y` does. Now it doesn't.")).toBe("wrangler >=4.1.0 changed what `x. y` does.");
    expect(firstSentence("vitest >=5.0.0 added `vi.when`.")).toBe("vitest >=5.0.0 added `vi.when`.");
    expect(firstSentence("No period")).toBe("No period");
    expect(firstSentence("agents >=0.22.0 changed the default of `throttle`. useAgentChat now coalesces.")).toBe("agents >=0.22.0 changed the default of `throttle`.");
    expect(firstSentence("Python 3.12 removed it, e.g. from the stdlib. Use this.")).toBe("Python 3.12 removed it, e.g. from the stdlib.");
  });
});

describe("the knowledge strips", () => {
  const only: Models = {
    ...models,
    models: { a: { name: "Model A" }, b: { name: "Model B" } },
    lessons: { L1: { a: "knows", b: "misses" }, L2: { a: "misses" }, GONE: { a: "knows", b: "knows" } },
  };
  const index = { version: 1, built_at: "", teachers: {}, lessons: [entry("L2", "x", ">=1.2.0"), entry("L1", "x", ">=1.10.0"), entry("L3", "w", ">=2.0.0")] } as Index;

  it("count only active lessons, and leave a lesson with no verdict not measured", () => {
    const k = knowledge(index, only, null);
    expect(k.lessons.map((l) => l.id)).toEqual(["L3", "L2", "L1"]); // subject, then version order (1.2 before 1.10)
    expect(k.strips).toEqual([
      { model: "a", name: "Model A", misses: expect.objectContaining({ correct: 1, total: 2 }), knows: 1, notMeasured: 1 },
      { model: "b", name: "Model B", misses: expect.objectContaining({ correct: 1, total: 1 }), knows: 0, notMeasured: 2 },
    ]);
    expect(k.lessons.find((l) => l.id === "L2")!.verdicts).toEqual({ a: "misses", b: null });
  });

  it("mark a lesson silent only when its claim says so (never an addition), and label agent drafts", () => {
    const k = knowledge({ ...index, lessons: [entry("S", "x", ">=1.0.0", { drafted_by: "agent" }), entry("A", "x", ">=1.1.0", { kind: "added" }), entry("L", "x", ">=1.2.0", { signal: "loud" })] }, only, null);
    expect(k.lessons.map((l) => [l.id, l.silent, l.drafted])).toEqual([
      ["S", true, true],
      ["A", false, false],
      ["L", false, false],
    ]);
  });

  it("are all not measured before any run", () => {
    const k = knowledge(index, { ...only, lessons: {} }, null);
    expect(k.strips.map((s) => [s.misses.total, s.notMeasured])).toEqual([
      [0, 3],
      [0, 3],
    ]);
  });

  it("give dates only from the file, and none for a version it doesn't have", () => {
    const file = { ...dates, versions: { "x@1.2.0": "2026-08-01T10:00:00.000Z" } };
    const k = knowledge(index, only, file);
    expect(k.lessons.map((l) => [l.id, l.released])).toEqual([
      ["L3", null],
      ["L2", "2026-08-01"],
      ["L1", null],
    ]);
    const axis = dateAxis(k, file)!;
    expect(axis.unfetched).toBe(2);
    expect(axis.rows[0]!.dots.map((d) => d.lesson.id)).toEqual(["L2"]);
  });
});

describe("--mark", () => {
  // WCAG relative luminance and contrast ratio.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const css = readFileSync(join(root, "apps/site/src/styles/tokens.css"), "utf8");
  const dark = css.slice(css.indexOf("prefers-color-scheme: dark"));
  const token = (block: string, name: string) => new RegExp(String.raw`--${name}:\s*(#[0-9a-f]{6})`).exec(block)![1]!;

  it.each([
    ["light", css],
    ["dark", dark],
  ])("stands out from the page and its panels in %s (3:1 for marks), as does not measured", (_, block) => {
    for (const bg of ["paper", "paper-2"]) expect(ratio(token(block, "mark"), token(block, bg)), bg).toBeGreaterThanOrEqual(3);
    expect(ratio(token(block, "checking-line"), token(block, "paper"))).toBeGreaterThanOrEqual(3);
  });
});

describe("docs/bench/release-dates.json", () => {
  it("has a registry time for each version, and a cutoff only with its published source", () => {
    for (const [key, at] of Object.entries(dates.versions)) {
      expect(key).toMatch(/^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+/);
      expect(Number.isNaN(Date.parse(at)), key).toBe(false);
    }
    for (const [model, c] of Object.entries(dates.cutoffs)) {
      expect(models.models[model], model).toBeDefined();
      expect(c.month).toMatch(/^\d{4}-\d{2}$/);
      expect(c.url).toMatch(/^https:\/\/(platform\.claude\.com|docs\.claude\.com|www\.anthropic\.com)\//);
      expect(c.quote.startsWith(`${c.row} | `)).toBe(true);
      expect(c.definition.startsWith(`${c.row}: `)).toBe(true);
    }
  });

  const built = join(root, "apps/site/dist/index.json");
  it.skipIf(!existsSync(built))("dates every npm lesson on the site by its lowest version", () => {
    const index = JSON.parse(readFileSync(built, "utf8")) as Index;
    const k = knowledge(index, models, dates);
    for (const l of (index.lessons as (Index["lessons"][number] & { version?: string; package?: { ecosystem: string; name: string } })[]).filter((l) => l.package?.ecosystem === "npm")) {
      const at = dates.versions[`${l.package!.name}@${semver.minVersion(l.version!)!.version}`];
      expect(k.lessons.find((x) => x.id === l.id)!.released, l.id).toBe(at ? at.slice(0, 10) : null);
    }
    // Squares per model: every active lesson, split as models.json says.
    for (const s of k.strips) {
      const v = index.lessons.map((l) => models.lessons[l.id]?.[s.model]);
      expect([s.knows, s.misses.correct, s.notMeasured]).toEqual([v.filter((x) => x === "knows").length, v.filter((x) => x === "misses").length, v.filter((x) => x === undefined).length]);
    }
  });

  const page = join(root, "apps/site/dist/bench/index.html");
  it.skipIf(!existsSync(page) || !existsSync(built))("says each model's count in words on the built /bench page", () => {
    const html = readFileSync(page, "utf8");
    const k = knowledge(JSON.parse(readFileSync(built, "utf8")) as Index, models, dates);
    for (const s of k.strips) expect(html).toContain(`${s.name} doesn&#39;t know ${s.misses.correct} of ${s.misses.total} measured lessons; ${s.notMeasured} not measured.`);
  });
});
