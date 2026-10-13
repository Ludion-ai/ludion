// Done 2, plumbing: from the merge of a `ludion teach --public` pull request, how long until
//   1. /index/vitest.json on the site lists the lesson,
//   2. `ludion sync` in another directory writes it with the teacher's name,
//   3. `ludion_ask` returns it.
// CLAUDE.md asks for all three within five minutes. Run it once the owner's pull request is open; it waits for the merge.
//   node docs/bench/2026-10-13-done2/measure.ts <pull request number> [--cli ludion-ai@0.1.4] [--site https://ludion.ai]
// For a rehearsal on a pull request that is already merged (the seconds will be large, the machinery is what is tried):
//   --project <dir> a project folder with the lockfile to sync, --question <text>, --cli-path <dist/cli.js> to run a local
//   build instead of npx, --out <file> for the result (default result.json next to this file).
// It needs the owner's gh (to read the pull request) and writes result.json next to itself. The lesson must be one for
// vitest >=4.0.0 whose claim is about vi.restoreAllMocks (docs/bench/2026-10-13-done2/draft.json): the fixture project
// installs vitest 4.0.0, and the question below was chosen before the run, on a local index (it found the draft first).
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    cli: { type: "string", default: "ludion-ai@0.1.4" },
    site: { type: "string", default: "https://ludion.ai" },
    project: { type: "string" },
    question: { type: "string" },
    "cli-path": { type: "string" },
    out: { type: "string" },
  },
});
const prNumber = positionals[0];
if (!prNumber || !/^\d+$/.test(prNumber)) {
  console.error("Usage: node docs/bench/2026-10-13-done2/measure.ts <pull request number> [--cli ludion-ai@0.1.4] [--site https://ludion.ai]");
  process.exit(2);
}
const REPO = "Ludion-ai/ludion";
const SITE = values.site!;
const LIMIT_MS = 5 * 60 * 1000;
const GIVE_UP_MS = 15 * 60 * 1000;
const QUESTION = values.question ?? "Does vi.restoreAllMocks reset the call history of vi.fn mocks in vitest 4?";
const here = import.meta.dirname;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const stamp = (ms: number) => new Date(ms).toISOString();

function gh(args: string[]): string {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${args.join(" ")} failed: ${r.stderr.trim()}`);
  return r.stdout;
}

interface Pr {
  state: string;
  merged_at: string | null;
  user: { login: string; id: number };
}

async function waitFor<T>(what: string, give: number, step: () => Promise<T | undefined>, everyMs = 2000): Promise<T> {
  const until = now() + give;
  let last: unknown;
  while (now() < until) {
    try {
      const v = await step();
      if (v !== undefined) return v;
    } catch (err) {
      last = err;
    }
    await sleep(everyMs);
  }
  throw new Error(`Gave up waiting for ${what}${last ? ` (last error: ${(last as Error).message})` : ""}.`);
}

const secs0 = (t: number) => Math.round((t - t0) / 1000);
// 1. The merge.
console.log(`Waiting for pull request #${prNumber} to be merged...`);
let t0 = 0;
const merged = await waitFor("the merge", 60 * 60 * 1000, async () => {
  const pr = JSON.parse(gh(["api", `repos/${REPO}/pulls/${prNumber}`])) as Pr;
  if (pr.state === "closed" && !pr.merged_at) throw new Error("the pull request was closed without a merge");
  return pr.merged_at ? pr : undefined;
}, 5000);
t0 = Date.parse(merged.merged_at!);
const teacher = merged.user;
const files = JSON.parse(gh(["api", `repos/${REPO}/pulls/${prNumber}/files`])) as { filename: string }[];
const lessonFile = files.map((f) => f.filename).find((f) => /^lessons\/vitest\/[0-9A-Z]{26}\.json$/.test(f));
if (!lessonFile) throw new Error(`Pull request #${prNumber} changes no lessons/vitest/<id>.json file.`);
const id = lessonFile.match(/([0-9A-Z]{26})\.json$/)![1]!;
console.log(`Merged ${merged.merged_at} by way of @${teacher.login} (${teacher.id}); lesson ${id}.`);

// The identity rule: author_id in the file is the numeric id of the account that opened the pull request.
const onMain = JSON.parse(Buffer.from((JSON.parse(gh(["api", `repos/${REPO}/contents/${lessonFile}?ref=main`])) as { content: string }).content, "base64").toString("utf8")) as {
  author: string;
  author_id: number;
  drafted_by?: string;
};
const identityOk = onMain.author_id === teacher.id && onMain.author === `github:${teacher.login}`;
console.log(`author_id check: ${identityOk ? "the file's author_id is the pull request account" : "MISMATCH"}`);

// 2. The site's shard.
const cacheBust = () => `?done2=${now()}`;
const t1 = await waitFor("the site to list the lesson", GIVE_UP_MS, async () => {
  const res = await fetch(`${SITE}/index/vitest.json${cacheBust()}`, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) return undefined;
  const shard = (await res.json()) as { lessons: { id: string; claim: string; teacher: string }[] };
  const entry = shard.lessons.find((l) => l.id === id);
  return entry ? { at: now(), claim: entry.claim, teacher: entry.teacher } : undefined;
});

console.log(`${secs0(t1.at)}s after the merge: the site lists the lesson.`);

// 3. sync in another directory, with an empty ledger so only the public index can supply the lesson.
const work = mkdtempSync(join(tmpdir(), "done2-"));
const project = join(work, "project");
cpSync(values.project ?? join(here, "project"), project, { recursive: true });
let syncAttempts = 0;
let lessonsMd = "";
const t2 = await waitFor("sync to write the lesson", GIVE_UP_MS, async () => {
  syncAttempts++;
  console.log(`sync attempt ${syncAttempts}...`);
  // A local build runs with node directly. npx is a .cmd file on Windows and needs a shell, which gets one command string.
  const env = { ...process.env, LUDION_HOME: join(work, "home") };
  const r = values["cli-path"]
    ? spawnSync(process.execPath, [resolve(values["cli-path"]), "sync", "--dir", project], { cwd: work, encoding: "utf8", env })
    : spawnSync(`npx -y ${values.cli} sync --dir "${project}"`, { cwd: work, encoding: "utf8", shell: true, env });
  const file = join(project, ".ludion", "lessons.md");
  if (r.status !== 0 || !existsSync(file)) return undefined;
  lessonsMd = readFileSync(file, "utf8");
  const lines = lessonsMd.split("\n");
  const at = lines.findIndex((l) => l.startsWith("- ") && l.includes(t1.claim.slice(0, 60)));
  return at >= 0 ? { at: now(), line: lines[at]!, next: lines[at + 1] ?? "" } : undefined;
}, 5000);
console.log(`${secs0(t2.at)}s after the merge: sync wrote the lesson (attempt ${syncAttempts}).`);
const syncNamesTeacher = t2.next.includes(`Taught by @${teacher.login}`);

// 4. ludion_ask.
async function rpc(body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(`${SITE}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = res.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join("") : text;
  return json ? JSON.parse(json) : null;
}
const init = (await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "ludion-done2", version: "1" } },
})) as { result: { protocolVersion: string } };
const protocol = { "mcp-protocol-version": init.result.protocolVersion };
let asked = "";
const t3 = await waitFor("ludion_ask to return the lesson", GIVE_UP_MS, async () => {
  const reply = (await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "ludion_ask", arguments: { question: QUESTION } } }, protocol)) as {
    result?: { content?: { text?: string }[] };
  };
  asked = (reply.result?.content ?? []).map((c) => c.text ?? "").join("\n");
  return asked.includes(id) || asked.includes(t1.claim.slice(0, 60)) ? now() : undefined;
}, 3000);
console.log(`${secs0(t3)}s after the merge: ludion_ask returned the lesson.`);
const askNamesTeacher = asked.includes(`@${teacher.login}`);

const secs = (t: number) => Math.round((t - t0) / 1000);
const result = {
  measured_at: stamp(now()),
  pull_request: Number(prNumber),
  lesson: id,
  teacher: { login: teacher.login, id: teacher.id },
  drafted_by: onMain.drafted_by ?? null,
  merged_at: stamp(t0),
  seconds_after_merge: { site_lists_lesson: secs(t1.at), sync_writes_lesson: secs(t2.at), ludion_ask_returns_lesson: secs(t3) },
  sync_attempts: syncAttempts,
  cli: values["cli-path"] ?? values.cli,
  question: QUESTION,
  checks: { author_id_is_the_pull_request_account: identityOk, sync_names_teacher: syncNamesTeacher, ludion_ask_names_teacher: askNamesTeacher },
  limit_seconds: LIMIT_MS / 1000,
};
const within = Object.values(result.seconds_after_merge).every((s) => s * 1000 <= LIMIT_MS);
const ok = within && Object.values(result.checks).every(Boolean);
writeFileSync(values.out ?? join(here, "result.json"), JSON.stringify({ ...result, passed: ok }, null, 2) + "\n");
console.log(JSON.stringify({ ...result, passed: ok }, null, 2));
console.log(ok ? "\nDone 2: PASSED (everything within five minutes of the merge, teacher named in sync and in ludion_ask)." : "\nDone 2: NOT passed. See the numbers and checks above.");
process.exit(ok ? 0 : 1);
