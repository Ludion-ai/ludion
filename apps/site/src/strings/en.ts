// Every UI string. Japanese will be a translation of this file, not a refactor.
import type { VerifiedBy } from "@ludion/core";
export const en = {
  site: {
    name: "Ludion",
    description: "Ludion is a public, writable AI model. People teach it, machines verify every lesson, and every assistant can use it.",
  },
  nav: {
    label: "Main",
    lessons: "Lessons",
    start: "Start",
    models: "Models",
  },
  home: {
    title: "Ludion: teach it once",
    headline: "Teach it once.",
    sub: "Everyone's AI learns it in minutes. Your name stays on it.",
    replayTitle: "How a lesson passes",
    checking: "Checking",
    replay: (by: VerifiedBy, date: string) =>
      `A replay of how this lesson passed: ${by === "test" ? "CI ran its test" : by === "differential" ? "CI ran its tests on two versions" : by === "proof" ? "Lean checked its proof" : "its quote was found on the source page"}, and it was verified on ${date}.`,
    logTitle: (by: VerifiedBy, runner: string) => (by === "source" ? "Source check" : by === "proof" ? "Proof check (lean)" : `Test (${runner})`),
    recent: "Recently verified",
    seeLessons: "See all lessons",
  },
  lessons: {
    title: "Lessons",
    intro: (shown: number, total: number) =>
      shown < total ? `The newest ${shown} of ${total} lessons.` : total === 1 ? "1 lesson." : `${total} lessons, newest first.`,
    empty: "No lessons yet.",
  },
  lesson: {
    verifiedBy: { test: "Verified by test", differential: "Verified across versions", proof: "Verified by proof", source: "Verified by source" },
    on: (date: string) => `on ${date}`,
    appliesTo: (subject: string, version?: string | null) => `Applies to ${subject}${version ? ` ${version}` : ""}`,
    taughtBy: "Taught by",
    evidence: "Evidence",
    test: (runner: string) => `Test (${runner})`,
    proof: "Proof (Lean)",
    mark: { test: "exit 0", differential: "pass / fail", proof: "proved", source: "quote found" },
    source: "Source",
    copy: "Copy",
    copied: "Copied",
    corrects: "Corrects",
    correctedBy: "This lesson was corrected by",
    failing: (date: string) => `This lesson failed its nightly check${date ? ` on ${date}` : ""}. Ludion stopped serving it until it is fixed or retracted.`,
    viewFile: "View the file on GitHub",
    pullRequest: (n: number) => `Pull request #${n}`,
    drafted: ", drafted by an agent",
    draftedAlone: "Drafted by an agent",
  },
  record: {
    verified: "Verified",
    appliesTo: "Applies to",
    teacher: "Teacher",
    check: "Check it yourself",
  },
  teacher: {
    title: (login: string) => `@${login} on Ludion`,
    summary: (lessons: number, subjects: number) =>
      `${lessons} ${lessons === 1 ? "lesson" : "lessons"} in ${subjects} ${subjects === 1 ? "subject" : "subjects"}`,
    profile: "GitHub profile",
    subjects: "Subjects",
  },
  subject: {
    title: (subject: string) => `${subject} lessons on Ludion`,
    summary: (lessons: number) => `${lessons} ${lessons === 1 ? "lesson" : "lessons"}, newest first.`,
  },
  tombstone: {
    title: (id: string) => `Retracted lesson ${id} | Ludion`,
    heading: "Retracted",
    banner: (date: string) => `This lesson was retracted on ${date}. Ludion no longer serves it.`,
    said: "It said",
    unreadable: "Its file can't be shown in today's lesson format.",
    pr: (n: number) => `Retraction: pull request #${n}`,
    history: "The file's history on GitHub",
  },
  models: {
    title: "Models | Ludion",
    heading: "Models",
    intro:
      "Which changes each model already knows, measured by FreshBench. ludion sync leaves out the lessons that the model it writes for is measured to know.",
    none: "No model has been measured yet.",
    measured: (date: string) => `Measured on ${date}.`,
    method: "How it was measured:",
    notMeasured: "not measured",
    run: "The run's questions, answers, and grades",
    model: "Model",
    knows: "Knows",
    misses: "Misses",
    lesson: "Lesson",
    verdict: { knows: "knows", misses: "misses" },
    perLesson: "Per lesson",
  },
  start: {
    title: "Start | Ludion",
    heading: "Start",
    intro: "Ludion tells your coding assistant what changed in the versions your project installed. Each change is checked by a machine and signed by the person who taught it.",
    claudeCode: "In Claude Code",
    claudeCodeBody:
      "The plugin runs ludion sync at the start of every session and adds the Ludion MCP server (ludion_ask, ludion_teach).",
    anyAssistant: "With any assistant",
    anyAssistantBody:
      "Run it in your project, and again after you upgrade. It reads your lockfile and writes .ludion/lessons.md, imports it from CLAUDE.md, names it in AGENTS.md if you have one, and adds a Cursor rule if you use Cursor.",
    mcp: "Just the MCP server",
    teach: "Teach a lesson",
    teachBody:
      "When your assistant gets a change wrong, ask it to draft a lesson with ludion_teach, then run the command it gives you. ludion teach shows you the whole lesson, checks its sources, runs its tests only in Docker, and saves it to your ledger, so sync writes it in every project on your machine that installs a matching version. Add --public to open a pull request in your own name; CI checks it again, and a maintainer merges it.",
    privacy: "What leaves your machine",
    privacyBody:
      "sync downloads the lesson lists for the packages in your lockfile, and nothing else. No telemetry. teach fetches the source pages it cites, and --public uses your own gh. Through the MCP server, ludion_ask sends your question to ludion.ai, and ludion_teach sends the draft.",
  },
  footer: {
    count: (lessons: number, teachers: number) =>
      `${lessons} ${lessons === 1 ? "lesson" : "lessons"} from ${teachers} ${teachers === 1 ? "teacher" : "teachers"}.`,
    license: "Lessons are CC BY-SA 4.0. Code is Apache-2.0.",
    github: "GitHub",
  },
  notFound: {
    title: "No page here",
    body: "No page here.",
    search: "Search the lessons",
    rest: " or teach one.",
  },
};

/** "node@24, vitest@5.0.3" or "python, expected to fail". The heading of a test on a lesson page. */
export const testLabel = (t: { runtime: string; packages?: Record<string, string>; expect?: "pass" | "fail" }): string =>
  [t.runtime, ...Object.entries(t.packages ?? {}).map(([n, v]) => `${n}@${v}`)].join(", ") + (t.expect === "fail" ? ", expected to fail" : "");

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** "Oct 8, 2026" */
export const formatDate = (iso: string): string => dateFormat.format(new Date(iso));
