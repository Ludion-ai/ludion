// Search quality: what ludion_ask returns for questions people actually ask, over the sample lessons
// (apps/site/samples) and the real ones (lessons/). Off-topic questions must find nothing (ludion_ask then answers
// with its no-match text); on-topic questions must find the right lesson in the top 3, at least 90% of the time.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIndex, search, validateLesson, type Lesson } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

function readLessons(dir: string): Lesson[] {
  const out: Lesson[] = [];
  for (const subject of readdirSync(dir, { withFileTypes: true })) {
    if (!subject.isDirectory()) continue;
    for (const file of readdirSync(join(dir, subject.name))) {
      const v = validateLesson(JSON.parse(readFileSync(join(dir, subject.name, file), "utf8")));
      if (!v.ok) throw new Error(`${file} is not a valid lesson`);
      out.push(v.lesson);
    }
  }
  return out;
}

const lessons = [...readLessons(join(root, "apps/site/samples/lessons")), ...readLessons(join(root, "lessons"))];
const index = buildIndex(lessons, {}, new Map(), { org: "Ludion-ai", repo: "ludion" });

/** Questions unrelated to every lesson: cooking, geography, sport, and technology the lessons don't cover. */
const OFF_TOPIC = [
  "What is the capital of France?",
  "How do I use docker?",
  "How do I make sourdough bread rise faster?",
  "What's a good recipe for chicken curry?",
  "How tall is Mount Everest?",
  "Who won the World Cup in 2018?",
  "How do I center a div with flexbox?",
  "How do I configure nginx as a reverse proxy?",
  "What is the best way to learn Kubernetes?",
  "How long should I boil an egg?",
  "What's the population of Tokyo?",
  "How do I write a for loop in Go?",
  "Explain quantum entanglement simply",
  "How do I set up a PostgreSQL replica?",
  "How do I deploy a React app to Vercel?",
  "How do I tune a sourdough starter?",
  // Words some lesson writes as code (RETURNING, INSERT, DELETE, HEAD), asked about something else.
  "How do I delete a file?",
  "How do I return a value from a function?",
  "Should I insert a new paragraph here?",
  "My head hurts after debugging",
];

/** Questions that name only a subject. Matching a subject name alone never returns a lesson. */
const SUBJECT_ONLY = [
  "What is Python?",
  "What is Rust?",
  "Tell me about git",
  "What is TypeScript?",
  "How do I use Node.js?",
  "What is SQLite?",
  "Explain CSS",
  "What is Cloudflare Workers?",
];

/** A whole pip log pasted as the question: over 1,000 characters, the error on the last line. */
const LONG_TRACEBACK = `Collecting legacy-thing==0.4.1
  Downloading legacy-thing-0.4.1.tar.gz (48 kB)
  Preparing metadata (setup.py) ... error
  error: subprocess-exited-with-error

  × python setup.py egg_info did not run successfully.
  │ exit code: 1
  ╰─> [18 lines of output]
      Traceback (most recent call last):
        File "<string>", line 2, in <module>
        File "<pip-setuptools-caller>", line 34, in <module>
        File "/tmp/pip-install-k2x9w8fq/legacy-thing_5d1c0b7e/setup.py", line 5, in <module>
          from legacy_build.helpers import configure
        File "/tmp/pip-install-k2x9w8fq/legacy-thing_5d1c0b7e/legacy_build/helpers.py", line 12, in <module>
          from legacy_build.compat import find_compiler
        File "/tmp/pip-install-k2x9w8fq/legacy-thing_5d1c0b7e/legacy_build/compat.py", line 3, in <module>
          import numpy.version
        File "/home/user/.venv/lib/python3.12/site-packages/numpy/version.py", line 9, in <module>
          from numpy.core.multiarray import _get_ndarray_c_version
        File "/home/user/.venv/lib/python3.12/site-packages/numpy/core/__init__.py", line 22, in <module>
          from . import multiarray
        File "/tmp/pip-install-k2x9w8fq/legacy-thing_5d1c0b7e/legacy_build/compiler.py", line 7, in <module>
          from distutils.ccompiler import new_compiler
      ModuleNotFoundError: No module named 'distutils'
      [end of output]

  note: This error originates from a subprocess, and is likely not a problem with pip.
error: metadata-generation-failed

× Encountered error while generating package metadata.
╰─> See above for output.`;

/**
 * Questions that must find their lesson in the top 3, every time: error messages pasted as they are (with traceback
 * lines), and questions that mix Japanese and English. Keyed by a phrase of the claim.
 */
const MUST_FIND: [string, string][] = [
  ["setup.py fails with ModuleNotFoundError: No module named distutils", "removed the distutils module"],
  [
    `Traceback (most recent call last):\n  File "/home/user/project/setup.py", line 3, in <module>\n    from distutils.core import setup\nModuleNotFoundError: No module named 'distutils'`,
    "removed the distutils module",
  ],
  [
    `Traceback (most recent call last):\n  File "/usr/lib/python3.12/site-packages/numpy/__init__.py", line 1, in <module>\n    import distutils.util\nModuleNotFoundError: No module named 'distutils'`,
    "removed the distutils module",
  ],
  ["ModuleNotFoundError: No module named 'cgi'", "removed cgi"],
  ["error: extern blocks must be unsafe", "unsafe extern"],
  ["Is distutils still in Python 3.12?", "removed the distutils module"],
  ["distutilsはPython 3.12で削除された？", "removed the distutils module"],
  ["Python 3.12でdistutilsが使えない", "removed the distutils module"],
  ["Node 22でWebSocketは標準で使える？", "global WebSocket client"],
  ["SQLiteでRETURNINGは使える？", "RETURNING on INSERT"],
  ["sqlite returning", "RETURNING on INSERT"],
  [LONG_TRACEBACK, "removed the distutils module"],
];

/** Two ways a person might ask about each active lesson, never the claim's own wording. Keyed by a phrase of the claim. */
const ON_TOPIC: Record<string, [string, string]> = {
  "removed cgi": ["Is the cgi module still in Python 3.13?", "cgi import fails after upgrading to Python 3.13"],
  "global WebSocket client": ["Does Node 22 have a built-in WebSocket?", "Do I still need the ws package for websockets in Node.js?"],
  "rfl proves it": ["How do I prove n + 0 = n in Lean 4?", "Why does rfl prove adding zero to a natural number in Lean?"],
  "git switch and git restore": ["What's the difference between git switch and git checkout?", "How do I restore a file with git restore?"],
  "tsc --init does not choose it": ["Does tsc --init enable moduleResolution bundler?", "What is moduleResolution bundler in TypeScript 5?"],
  "period of 10 or 60 seconds": ["What periods can a Cloudflare Workers rate limiting binding use?", "Can a Workers rate limit binding use a 30 second window?"],
  "sort -V puts version 1.10": ["How do I sort version numbers correctly with sort?", "Why does sort put 1.10 before 1.9?"],
  "unsafe extern": ["Do extern blocks need unsafe in Rust 2024?", "Rust 2024 edition extern block error"],
  "dict keeps insertion order": ["Are Python dicts ordered?", "Does dict preserve insertion order in Python 3.7?"],
  "CSS :has() selector": ["Can I use the :has() selector in all browsers?", "Is CSS :has supported in Firefox?"],
  "RETURNING on INSERT": ["Does SQLite support RETURNING?", "How do I return a row from an INSERT in SQLite?"],
  "toHaveTextContent is strict": ["Does toHaveTextContent match part of the text in Vitest 5?", "How do I check partial text content with Vitest 5 browser mode?"],
  // Seed lessons (FreshBench's A and B questions for each change).
  "changed what `-t` does": ["How do I run one nested test with -t when it is inside a describe block in Vitest?", "What separator does Vitest's testNamePattern use between suite and test names?"],
  "changed the default of `extends`": ["Do inline projects in test.projects inherit options from the root Vitest config?", "Do I need extends: true for each inline project to pick up my root Vitest settings?"],
  "added `vi.when`": ["How do I make a Vitest mock return different values depending on its arguments?", "Does Vitest have something like jest-when for argument-based mock results?"],
  "added `--repeats`": ["How do I run each test several times in a row with the Vitest CLI to find flaky tests?", "What does vitest --repeats do?"],
  "added `-p`": ["Is there a short flag for --project in the Vitest CLI?", "What does vitest -p do?"],
  "changed what `vitest list` does": ["Does vitest list run my test files to collect the tests?", "How does vitest list find tests without executing them?"],
  "changed what `vitest.config` does": ["Will Vitest find a vitest.config.ts in a parent directory when I run it from a subfolder?", "I run vitest inside packages/foo and it ignores the root config. Is that expected?"],
  "exactly equal to the expected string": ["Does toHaveTextContent in Vitest match a substring of the element's text?", "How do I check that an element's text contains a phrase in Vitest browser mode?"],
  "changed the default of `--merge-reports`": ["Where does vitest --reporter=blob write its output by default?", "Which folder does vitest --merge-reports read from by default?"],
  "changed what `deploy` does": ["Does wrangler deploy create my KV namespaces and queues automatically if they don't exist yet?", "Is automatic resource provisioning in wrangler deploy still in beta?"],
  "renamed `/cdn-cgi/handler/scheduled`": ["Under which path are Miniflare's local testing endpoints, like the local scheduled trigger, served now?", "Do /cdn-cgi/ test endpoints in wrangler dev still work after the move to Miniflare v5?"],
  "changed the default of `X_LOCAL_OBSERVABILITY`": ["Where do console logs and traces go when I run wrangler dev, and how do I stop it from collecting them?", "What does X_LOCAL_OBSERVABILITY=false do in wrangler dev?"],
  "`DO_NOT_TRACK`": ["How do I turn off Wrangler's telemetry with an environment variable?", "Does Wrangler respect DO_NOT_TRACK=1?"],
  "added `--jurisdiction us`": ["How do I create a D1 database that stays in the US jurisdiction with wrangler?", "Which data-location jurisdictions can I pass when creating a D1 database from the CLI?"],
  "changed the default of `nodejs_compat`": ["My Worker has a compatibility date after August 2026. How do I turn Node.js compatibility off?", "Is adding no_nodejs_compat to compatibility_flags enough to opt a recent Worker out of Node.js APIs?"],
  "changed what `--latest` does": ["What does the --latest flag do on wrangler deploy?", "How can I make wrangler versions upload pick the newest compatibility date automatically?"],
  "added `connect`": ["Can a Cloudflare Worker accept raw TCP connections, like a Postgres proxy listening on port 5432?", "What is the connect handler in a Worker, and how do I configure it in wrangler?"],
  "added `workflows[].concurrency.limit`": ["How do I cap how many instances of a Cloudflare Workflow run at the same time?", "Is there a wrangler config setting for a Workflow's concurrency limit?"],
  "defaults to deferred with a 5-minute maximum delay": ["Can I make Durable Objects keep running old code for a while after a wrangler deploy instead of restarting them immediately?", "Why do my Durable Objects still run the old code for minutes after wrangler deploy?"],
  "renamed `WRANGLER_R2_SQL_AUTH_TOKEN`": ["Which environment variable holds the auth token for wrangler basin sql?", "My R2 SQL script exports WRANGLER_R2_SQL_AUTH_TOKEN; does wrangler still read it?"],
  "renamed `wrangler r2 sql`": ["What wrangler command do I use to run an R2 SQL query?", "Where did the wrangler r2 sql and wrangler pipelines commands go?"],
  "changed what `wrangler versions secret bulk` does": ["How do I delete a secret with wrangler versions secret bulk?", "In the JSON for wrangler versions secret bulk, what does a null value do?"],
  "changed what `createMcpHandler` does": ["Can createMcpHandler in the agents package serve an McpServer from @modelcontextprotocol/server v2?", "How do I serve a stateless MCP server from a Worker with the Cloudflare agents package and the v2 MCP SDK?"],
  "changed what `MCPClientConnection` does": ["When the Cloudflare Agents MCP client connects to a server, what does it send first?", "Does the Agents SDK MCP client still start every connection with initialize?"],
  "changed the default of `throttle`": ["Does useAgentChat render every streamed chunk, or does it throttle updates?", "How do I make useAgentChat update the UI on every token?"],
  "added `Scheduler`": ["Can I use the Agents SDK's scheduling in a plain Durable Object that isn't an Agent?", "What does agents/schedules export?"],
  "changed what `Agent` does": ["Does the Cloudflare Agent class still extend PartyServer's Server?", "What base class does Agent extend in the Cloudflare Agents SDK?"],
  "deprecated `subAgent()`": ["Should I still use subAgent() in the Cloudflare Agents SDK?", "What replaces subAgent() for managing dynamic agents?"],
  "changed what `queue()` does": ["Inside a callback queued with this.queue() in an Agent, does getCurrentAgent() return the original connection and request?", "My queued Agent callback can't see the request that queued it. Is that expected?"],
  "added `transport`": ["What transports can useAgent use besides WebSockets?", "How do I use Cap'n Web RPC with AgentClient in the Cloudflare Agents SDK?"],
  "added `npx agents tui`": ["Is there a terminal client for talking to a Cloudflare agent from the command line?", "What does npx agents tui do?"],
  "removed the distutils module": ["What changed about distutils in Python 3.12?", "distutils import error on Python 3.12"],
};

/** Keys of lessons that teach the same change, so a question about it may find either. */
const SAME_CHANGE: [string, string][] = [["toHaveTextContent is strict", "exactly equal to the expected string"]];

describe("search quality", () => {
  it("covers every active lesson with two on-topic questions", () => {
    const covered = index.lessons.filter((l) => Object.keys(ON_TOPIC).some((key) => l.claim.includes(key)));
    expect(covered.map((l) => l.id).sort()).toEqual(index.lessons.map((l) => l.id).sort());
  });

  it("finds nothing for off-topic and subject-only questions, and the right lesson in the top 3 for on-topic ones", () => {
    const short = (q: string) => q.split("\n").at(-1)!;
    const findsSomething = (questions: string[]) =>
      questions.map((q) => ({ q, got: search(index, q).map((l) => l.claim.slice(0, 50)) })).filter((r) => r.got.length > 0);
    const offHits = findsSomething(OFF_TOPIC);
    const subjectHits = findsSomething(SUBJECT_ONLY);

    const check = (q: string, key: string) => {
      const want = index.lessons.find((l) => l.claim.includes(key))!;
      const got = search(index, q, { k: 3 });
      // Listed pairs teach the same change, so either is the right answer (the design sample and a seed).
      const twins = SAME_CHANGE.flatMap(([a, b]) => (a === key ? [b] : b === key ? [a] : []));
      const same = (l: (typeof got)[number]) => l.id === want.id || twins.some((k) => l.claim.includes(k));
      return { q: short(q), ok: got.some(same), got: got.map((l) => l.claim.slice(0, 40)) };
    };
    // Questions can land before their lesson does (a lesson PR changes only lesson files): skip keys with no active lesson.
    const onResults = Object.entries(ON_TOPIC).filter(([key]) => index.lessons.some((l) => l.claim.includes(key))).flatMap(([key, questions]) => questions.map((q) => check(q, key)));
    const onHits = onResults.filter((r) => r.ok).length;
    const onRate = onHits / onResults.length;
    const mustResults = MUST_FIND.map(([q, key]) => check(q, key));
    const mustMisses = mustResults.filter((r) => !r.ok);

    // Written straight to stdout so the numbers show in every run, passing or not.
    process.stdout.write(
      [
        `Search quality over ${index.lessons.length} lessons:`,
        `  off-topic: ${OFF_TOPIC.length - offHits.length}/${OFF_TOPIC.length} found nothing (needs all)`,
        ...offHits.map((r) => `    returned something for "${r.q}": ${JSON.stringify(r.got)}`),
        `  subject only: ${SUBJECT_ONLY.length - subjectHits.length}/${SUBJECT_ONLY.length} found nothing (needs all)`,
        ...subjectHits.map((r) => `    returned something for "${r.q}": ${JSON.stringify(r.got)}`),
        `  on-topic: ${onHits}/${onResults.length} found the right lesson in the top 3 (${(onRate * 100).toFixed(0)}%, needs 90%)`,
        ...onResults.filter((r) => !r.ok).map((r) => `    missed "${r.q}": ${JSON.stringify(r.got)}`),
        `  error messages and mixed Japanese: ${MUST_FIND.length - mustMisses.length}/${MUST_FIND.length} found the right lesson (needs all)`,
        ...mustMisses.map((r) => `    missed "${r.q}": ${JSON.stringify(r.got)}`),
      ].join("\n") + "\n",
    );

    expect(offHits.map((r) => r.q), "off-topic questions must return nothing").toEqual([]);
    expect(subjectHits.map((r) => r.q), "subject-only questions must return nothing").toEqual([]);
    expect(onRate, "on-topic questions must find the right lesson in the top 3").toBeGreaterThanOrEqual(0.9);
    expect(mustMisses.map((r) => r.q), "error messages and mixed questions must find their lesson").toEqual([]);
  });
});
