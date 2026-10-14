// Everything the film shows that a machine or a model produced: read from the records in this repository at render
// time, never typed in by hand (CLAUDE.md: "Verified means verified"). If a record moves or a lesson is retracted,
// rendering fails here instead of showing something that is no longer true.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { generateClaim } from "../../packages/core/src/claim.ts";

const QUESTION_ID = "vitest-5-0-0-14-b";
const HERO = "01M4N4KZ0QT41TY27SW0E683RX"; // vitest >=5.0.0 changed the default of `extends`
// The montage: silent changes from the three wedge subjects, one per eighth note, ending on the hero.
const MONTAGE = [
  "01M4N6JH32A6VDF5FJ7BTGEKVH", // wrangler nodejs_compat
  "01M4QHMS4JTBGD9PVWF1C97TRS", // vitest clearMocks
  "01M4N4KZ1J8367WF5VY4DJ5K23", // agents queue()
  "01M4N60GGAXDCRBZWTCH2BDW6X", // wrangler r2 sql → basin sql
  "01M4N4KZ1EJW4GSZR1169785QP", // agents throttle
  "01M4T6BQ9DJH2BCV6Q28GH4HJ1", // vitest vi.restoreAllMocks
  HERO,
];

const json = (path) => JSON.parse(readFileSync(path, "utf8"));

/** The answer up to and including `until`, then an ellipsis: an excerpt, never an edit. */
function excerpt(answer, until) {
  const at = answer.indexOf(until);
  if (at < 0) throw new Error(`excerpt: "${until}" is not in the recorded answer`);
  return `${answer.slice(0, at + until.length)} …`;
}

/** The generated claim's first sentence (package, versions, kind, symbol), from the same generator sync uses. */
const headOf = (l) => generateClaim({ ...l, detail: undefined, signal: "loud" }).replace(/ Older versions don't have it\.$/, "");

export function loadRecorded(repo) {
  const bench = join(repo, "docs/bench/2026-10-11-done3");
  const question = json(join(bench, "questions.json")).find((q) => q.id === QUESTION_ID);
  const answerOf = (label) => json(join(bench, `answers-B-${label}.json`)).answers.find((a) => a.id === QUESTION_ID).answer;
  const gradesOf = (label) => json(join(bench, `grades-B-${label}.json`));
  const without = gradesOf("project");
  const withSync = gradesOf("project-sync");
  const gradeOf = (g) => g.grades.find((x) => x.id === QUESTION_ID).grade;
  const count = (g) => g.grades.filter((x) => x.grade === "correct").length;
  const answersMeta = json(join(bench, "answers-B-project.json"));

  // Lessons on main, by id.
  const lessons = new Map();
  const root = join(repo, "lessons");
  for (const subject of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    for (const f of readdirSync(join(root, subject.name)).filter((f) => f.endsWith(".json"))) {
      const l = json(join(root, subject.name, f));
      lessons.set(l.id, l);
    }
  }
  const lesson = (id) => {
    const l = lessons.get(id);
    if (!l) throw new Error(`lesson ${id} is not on this branch (retracted?)`);
    if (l.format !== 1) throw new Error(`lesson ${id} is not format 1`);
    return l;
  };

  const hero = lesson(HERO);
  const heroClaim = generateClaim(hero);
  // The two lines sync wrote for the hero lesson, from the recorded lessons.md.
  const md = readFileSync(join(repo, "video/recordings/lessons.md"), "utf8").split("\n");
  const at = md.findIndex((line) => line.startsWith(`- ${heroClaim}`));
  if (at < 0) throw new Error("the hero lesson's claim is not in recordings/lessons.md");
  const teacherLine = md[at + 1].trim().replace(/ https:\S+$/, "");
  const installed = /installed \(([^)]+)\)/.exec(md.find((l) => l.startsWith("Changes in the versions")))[1];

  const sync = readFileSync(join(repo, "video/recordings/sync-output.txt"), "utf8")
    .split("\n")
    .filter((l) => l.startsWith("ludion: "));

  const tests = hero.evidence
    .filter((e) => e.test)
    .map((e) => ({ version: e.test.packages[hero.package.name], expect: e.test.expect, error: e.test.error }))
    .sort((a, b) => a.version.localeCompare(b.version, "en", { numeric: true }));

  // Every silent lesson's first sentence: the wall behind the montage.
  const wall = [...lessons.values()]
    .filter((l) => l.format === 1 && l.signal === "silent" && l.kind !== "added")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(headOf);

  const drafted = [...MONTAGE.map(lesson), ...[...lessons.values()].filter((l) => l.format === 1 && l.signal === "silent")].every((l) => l.drafted_by === "agent");

  return {
    question: question.question,
    model: answersMeta.model,
    installed, // "vitest 5.0.3"
    without: {
      excerpt: excerpt(answerOf("project"), "unless you add `extends: true`,"),
      grade: gradeOf(without),
    },
    with: {
      excerpt: excerpt(answerOf("project-sync"), "so adding it to each project changes nothing."),
      grade: gradeOf(withSync),
    },
    bench: { total: without.grades.length, without: count(without), with: count(withSync), date: "2026-10-11" },
    montage: MONTAGE.map((id) => {
      const l = lesson(id);
      return { id, pkg: `${l.package.name} ${l.versions}`, head: headOf(l).slice(`${l.package.name} ${l.versions} `.length) };
    }),
    montageTeacher: drafted ? "Taught by @Ludion-ai, drafted by an agent" : null,
    wall,
    lesson: {
      pkg: `${hero.package.name} ${hero.versions}`,
      head: headOf(hero).slice(`${hero.package.name} ${hero.versions} `.length),
      detail: hero.detail.endsWith(".") ? hero.detail : `${hero.detail}.`,
      silent: heroClaim.slice(heroClaim.indexOf("Silent: ")),
      teacher: teacherLine,
      tests,
      packageName: hero.package.name,
    },
    sync: { command: "npx ludion-ai sync", output: sync, recorded: "Recorded 2026-10-14: ludion-ai 0.1.4 in the benchmark's vitest project." },
  };
}

/** Where each recorded thing came from: printed by render.mjs and kept in README.md. */
export const SOURCES = [
  ["question, both answers, grades, B totals", "docs/bench/2026-10-11-done3/ (questions.json, answers-B-*.json, grades-B-*.json)"],
  ["lesson claims and evidence", "lessons/ on this branch, claims built by packages/core generateClaim"],
  ["sync output and the teacher line", "video/recordings/ (npx ludion-ai sync, ludion-ai 0.1.4, 2026-10-14)"],
];
