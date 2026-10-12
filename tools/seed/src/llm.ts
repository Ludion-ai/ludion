// The pipeline's model calls go through Claude Code headless, with the bench's run-only configuration
// (tools/bench/src/agent.ts): an empty or prepared folder, no user settings, only the tools a step needs.
import { runAgent, type AgentRun, type RunOptions } from "../../bench/src/agent.ts";

export type { AgentRun };

/** The first JSON value in a model's answer: a ```json block if there is one, else the outermost [..] or {..}. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  const candidates = fenced ? [fenced[1]!] : [];
  const first = text.search(/[[{]/);
  if (first >= 0) {
    const close = text[first] === "[" ? "]" : "}";
    candidates.push(text.slice(first, text.lastIndexOf(close) + 1));
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`No JSON in the answer: ${text.slice(0, 200)}`);
}

/** Run up to `limit` jobs at once, in order of the input; each result or error lands at its own index. */
export async function pool<T, R>(items: T[], limit: number, job: (item: T, i: number) => Promise<R>): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await job(items[i]!, i);
      } catch (err) {
        out[i] = err as Error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A model call with no tools at all: the prompt is everything it sees. */
export function ask(prompt: string, model: string, maxBudgetUsd = 2): Promise<AgentRun> {
  return runAgent(prompt, { condition: "none", model, maxTurns: 2, maxBudgetUsd, timeoutMs: 15 * 60_000 });
}

/**
 * An agent in a prepared folder that can read, search, and write files there, and nothing else: no Bash, no web.
 * It reads untrusted text (release notes, pull requests, package code), so it gets no way to run anything.
 */
export function agentIn(folder: string, prompt: string, model: string, o: Partial<RunOptions> = {}): Promise<AgentRun> {
  return runAgent(prompt, { condition: "project", project: folder, allowEdits: true, model, maxTurns: 60, maxBudgetUsd: 8, timeoutMs: 30 * 60_000, ...o });
}
