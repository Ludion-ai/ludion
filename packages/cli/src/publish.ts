// ludion teach --public: open the pull request with the teacher's own gh, from their own account. Ludion never
// holds a token: the PR author is whoever is signed in to gh, and CI checks that author_id is that account.
import { execFileSync } from "node:child_process";
import { formatLesson, generateClaim, type LessonV1 } from "@ludion/core";
import type { Identity } from "./teach.ts";

export const UPSTREAM = process.env.LUDION_REPO || "Ludion-ai/ludion";

export type Gh = (args: string[]) => string;
export const gh: Gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

export function prTexts(lesson: LessonV1, who: Identity): { title: string; body: string; message: string } {
  const title = `Teach ${lesson.subject}: ${lesson.symbol}`.slice(0, 120);
  const evidence = lesson.evidence.map((e) => ("source" in e ? `source (${new URL(e.source.url).host})` : `test (${e.test.runtime}${e.test.expect === "fail" ? ", expected to fail" : ""})`));
  const body = [
    generateClaim(lesson),
    "",
    `Evidence: ${evidence.join(", ")}.`,
    `Taught by @${who.login}${lesson.drafted_by === "agent" ? ", drafted by an agent" : ""}, opened with ludion teach --public.`,
    "",
    "What changes: one new lesson file. How to undo: delete the file (a retraction).",
  ].join("\n");
  return { title, body, message: `${title}\n\nTaught by @${who.login} (${who.id}).` };
}

/**
 * Branch, file, pull request. With push access to the upstream repo the branch goes there; otherwise into the
 * teacher's fork, synced with upstream first.
 */
export function openPullRequest(lesson: LessonV1, who: Identity, run: Gh = gh): string {
  const canPush = run(["api", `repos/${UPSTREAM}`, "--jq", ".permissions.push"]) === "true";
  const name = UPSTREAM.split("/")[1]!;
  let target = UPSTREAM;
  if (!canPush) {
    run(["repo", "fork", UPSTREAM, "--clone=false"]);
    target = `${who.login}/${name}`;
    run(["api", "--method", "POST", `repos/${target}/merge-upstream`, "-f", "branch=main"]);
  }
  const sha = run(["api", `repos/${target}/git/ref/heads/main`, "--jq", ".object.sha"]);
  const branch = `teach/${lesson.subject}/${lesson.id}`;
  run(["api", "--method", "POST", `repos/${target}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
  const { title, body, message } = prTexts(lesson, who);
  run([
    "api", "--method", "PUT", `repos/${target}/contents/lessons/${lesson.subject}/${lesson.id}.json`,
    "-f", `message=${message}`,
    "-f", `content=${Buffer.from(formatLesson(lesson)).toString("base64")}`,
    "-f", `branch=${branch}`,
  ]);
  return run(["pr", "create", "--repo", UPSTREAM, "--base", "main", "--head", canPush ? branch : `${who.login}:${branch}`, "--title", title, "--body", body]);
}
