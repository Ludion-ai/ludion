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
    bench: "Bench",
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
    failing: (date: string) => `This lesson failed its nightly check${date ? ` on ${date}` : ""}. Ludion stopped serving it until it passes its check again or is retracted.`,
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
  bench: {
    title: "Bench | Ludion",
    heading: "Bench",
    intro:
      "FreshBench asks coding assistants about changes in the versions a project installed, and a judge grades each answer against a key checked against primary sources. Every count comes with its 95% Wilson interval, and each part of this page says what it counts.",
    measured: (date: string) => `Measured on ${date}`,
    ago: (days: number) => (days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`),
    files: "The run's questions, answers, grades, and logs",
    method: "How it was measured",
    json: "This table as JSON",
    reproduce: "Run it again",
    reproduceNote: (dir: string) =>
      `The parts in brackets are the run with sync. Its CLI and lessons are the ones frozen for the run, served from the repository at that commit, not today's ludion.ai. Setup: ${dir}/README.md.`,
    done3Heading: "In a project, with and without ludion sync",
    done3Caption: (questions: number, frozenAt: string | null, seeds: number) =>
      `FreshBench B questions (${questions}, one per change), asked to Claude Code in a project with the new versions installed. Each cell: answers graded correct out of questions.${frozenAt ? ` With sync, the project got the ${seeds} seed lessons frozen at commit ${frozenAt}.` : ""}`,
    withoutToolsHeading: "Without tools",
    withoutToolsCaption: (lessons: number) =>
      `FreshBench A questions for the ${lessons} measured lessons, each asked twice with no tools. A cell counts the lessons whose change the model answered right both times; ludion sync leaves those lessons out for that model.`,
    model: "Model",
    condition: "Condition",
    all: "All",
    tools: "Claude Code's read-only tools",
    noTools: "No tools",
    webSearch: (on: boolean) => (on ? "web search on" : "web search off"),
    sync: (on: boolean) => (on ? "ludion sync on" : "ludion sync off"),
    notMeasured: "Not measured",
    interval: (low: string, high: string) => `95% interval ${low} to ${high}`,
    percent: (x: number) => `${Math.round(x * 100)}%`,
    range: (low: number, high: number) => `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
    none: "No model has been measured yet.",
    notMeasuredCell: "not measured",
    modelPage: {
      title: (name: string) => `${name} on FreshBench | Ludion`,
      description: (name: string) => `What ${name} got wrong on FreshBench, question by question.`,
      misses: "Questions it didn't get right",
      missesIn: (sync: boolean) => (sync ? "With ludion sync" : "Without ludion sync"),
      noMisses: "None.",
      question: "Question",
      subject: "Subject",
      grade: "Grade",
      lessonCol: "Lesson",
      log: "Log",
      noLesson: "no lesson for this change",
      unpublished: "its lesson was not published",
      every: "Every answer",
      everyCaption: "Each grade links to that run's log.",
      missedLessons: "Lessons it misses without tools",
      knowsAll: "None.",
      notMeasured: "This model has no run in a project yet.",
      back: "All models",
    },
    grade: { correct: "correct", wrong: "wrong", no_answer: "no answer" } as Record<string, string>,
    run: {
      title: (id: string, sync: boolean) => `${id}, ${sync ? "with" : "without"} ludion sync | Ludion`,
      question: "Question",
      key: "Answer key",
      accept: "A correct answer says",
      reject: "The stale answer",
      answer: "Answer",
      grade: "Grade",
      why: "The judge's reason",
      log: "Session log",
      logNote: (path: string) =>
        `What the agent wrote, the tools it called, and what they returned, from ${path}. Thinking and the session's settings are left out.`,
      noLog: "This run has no log file.",
      tool: (name: string) => `Tool call: ${name}`,
      result: "Tool output",
      resultError: "Tool output (error)",
      text: "Agent",
      truncated: (max: number) => `Cut at ${max.toLocaleString("en-US")} characters; the whole output is in the log file.`,
      raw: "The raw log",
      judgeLog: "The judge's log",
      cost: (usd: string) => `Answering cost $${usd}.`,
      lesson: "The change's lesson",
    },
    methodPage: {
      title: "How FreshBench measures | Ludion",
      heading: "How FreshBench measures",
      cost: "What each run cost",
      costCaption: "Summed from the costUsd of every answer and every grade in the run's files.",
      run: "Run",
      answering: "Answering",
      judging: "Judging",
      total: "Total",
      usd: (x: number) => `$${x.toFixed(2)}`,
      source: "This page is docs/bench/README.md.",
    },
    card: {
      title: (name: string) => `${name}: FreshBench card`,
    },
    knowledge: {
      heading: "What each model knows, lesson by lesson",
      caption: (lessons: number) =>
        `One square per lesson (${lessons}). Filled: the model answered the change right both times, with no tools. Empty: it didn't. Dotted: not measured yet.`,
      count: "measured lessons it doesn't know",
      notMeasured: (n: number) => (n === 1 ? "1 lesson not measured" : `${n} lessons not measured`),
      summary: (name: string, misses: number, measured: number, none: number) =>
        `${name} doesn't know ${misses} of ${measured} measured lessons; ${none} not measured.`,
      tip: { knows: "knows", misses: "doesn't know", none: "not measured" } as Record<string, string>,
      cardNote: (none: number) =>
        `A square per lesson. Filled: it answered the change right twice, with no tools. Empty: it didn't.${none ? " Dotted: not measured yet." : ""}`,
    },
    lift: {
      heading: "In a project, with and without ludion sync",
      points: "points",
      difference: (from: string, to: string) => `Difference between ${from} and ${to}, in percentage points.`,
      bar: (label: string, correct: number, total: number, low: string, high: string) =>
        `${label}: ${correct} of ${total} answered right, 95% interval ${low} to ${high}.`,
      notMeasured: (names: string) => `Not measured in a project: ${names}.`,
      bySubject: "By subject",
    },
    dates: {
      heading: "Knowledge dates",
      caption:
        "Each dot is a lesson, placed on the day npm published the first version it is about. Filled: the model knows it. Hollow: it doesn't. Dotted: not measured. The gray band is a model's reliable knowledge cutoff, where its maker publishes one.",
      cutoff: (month: string) => `Reliable knowledge cutoff, ${month}`,
      cutoffSource: "Cutoffs as Anthropic's model overview publishes them",
      measured: "Measured",
      notNpm: (n: number) => (n === 1 ? "1 lesson isn't about an npm package and has no date here." : `${n} lessons aren't about an npm package and have no date here.`),
      unfetched: (n: number) => (n === 1 ? "1 lesson is for a version whose date hasn't been fetched yet." : `${n} lessons are for versions whose dates haven't been fetched yet.`),
      source: "Publish dates from the npm registry",
      span: (n: number, first: string, last: string) => `${n} lessons are dated, from ${first} to ${last}.`,
      summary: (name: string, cutoff: string | null) => `${name}${cutoff ? `, reliable knowledge cutoff ${cutoff}` : ""}`,
    },
    list: {
      heading: "Every lesson",
      subject: "Subject",
      kind: "Kind",
      silentOnly: "Silent only",
      all: "All",
      showing: (n: number, of: number) => `${n} of ${of}`,
      silent: "silent",
      silentTitle: "Silent: code written for older versions still runs, without an error.",
      verdict: (name: string, v: string) => `${name}: ${v}`,
    },
    kind: { added: "added", removed: "removed", renamed: "renamed", deprecated: "deprecated", default: "default", behavior: "behavior" } as Record<string, string>,
    methodDetails: "How this was measured, and how to run it again",
    month: (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
    monthShort: (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
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
    license: "Lessons are CC BY 4.0. Code is Apache-2.0.",
    github: "GitHub",
    analytics: "This site uses Google Analytics.",
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
