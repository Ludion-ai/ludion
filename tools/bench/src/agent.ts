// Runs one question through Claude Code headless (`claude -p`) in a new empty folder, with a configuration that
// exists only for the run (docs/decisions.md, Bench), and returns what it said and which tools it called.
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trustedCommand } from "../../verify/src/command.ts";

/** none: no tools. web: web search/fetch. ludion: web plus MCP. project: explicit tools in a prepared project copy. */
export type Condition = "none" | "web" | "ludion" | "project" | "files";

export interface AgentRun {
  condition: Condition;
  model: string;
  /** Text of the final answer. */
  answer: string;
  /** Every tool the agent called, in order, by name (WebSearch, WebFetch, mcp__ludion__ludion_ask, ...). */
  toolCalls: string[];
  /** MCP servers as the session reported them at start: name → status. */
  mcpServers: Record<string, string>;
  costUsd: number;
  turns: number;
  isError: boolean;
  /** The raw stream-json lines, kept as the run's log. */
  log: string[];
}

export interface RunOptions {
  condition: Condition;
  model: string;
  maxTurns: number;
  /** Per-run spending cap passed to --max-budget-usd. */
  maxBudgetUsd: number;
  /** Text for a CLAUDE.md in the run's folder, or none. */
  claudeMd?: string;
  /** Text appended to the system prompt (for example lesson drafts given as context). */
  appendSystemPrompt?: string;
  ludionUrl?: string;
  /** Kill the run after this long. Default 10 minutes. */
  timeoutMs?: number;
  /** project condition: a prepared project folder (packages installed) copied into the run's folder. */
  project?: string;
  /** project condition: let the agent edit files (then it gets no Bash). Default: read-only. */
  allowEdits?: boolean;
  /** Called with the run's folder before Claude Code starts (for example to run ludion sync). */
  prepare?: (workDir: string) => void;
}

/**
 * Tools for the project condition. The agent reads untrusted text (web pages, node_modules) on this machine, so it
 * never gets both a way to write files and a way to run them:
 * - read-only (the default, for questions): read and search, run the project's existing tests and read-only package
 *   commands, use the web. It can't write, so the tests it runs are the project's own.
 * - with edits (for tasks): read, search, edit, use the web, and no Bash at all; the harness runs the tests afterwards.
 */
export function projectTools(allowEdits: boolean): string[] {
  // These are pre-approval rules, not the available tool list. Bare file-tool rules cover arbitrary paths.
  // Leave file access to restricted mode's working-directory checks and edits to scoped acceptEdits.
  const read = ["WebSearch", "WebFetch"];
  return allowEdits
    ? read
    : [...read, "Bash(npm test)", "Bash(npm ls:*)", "Bash(npm view:*)", "Bash(npx vitest run)", "Bash(npx wrangler --version)", "Bash(ls:*)"];
}
/** Only what Claude Code needs to start and find its own sign-in; no tokens or other secrets from this shell. */
const ENV_KEEP = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "NUMBER_OF_PROCESSORS", "OS", "LANG"];
export function runEnv(env: NodeJS.ProcessEnv = process.env, condition?: Condition): NodeJS.ProcessEnv {
  // In GitHub Actions (the nightly seed watch), Claude Code signs in with the ANTHROPIC_API_KEY secret; on a person's
  // machine it uses its own sign-in, and a key in that shell stays out.
  // Only the seed pipeline's no-tool or folder-confined runs receive the CI key.
  // Project/web conditions and callers without an explicit condition retain no CI credential.
  const keep = env.GITHUB_ACTIONS === "true" && (condition === "none" || condition === "files") ? [...ENV_KEEP, "ANTHROPIC_API_KEY"] : ENV_KEEP;
  return Object.fromEntries(keep.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
}

const WEB_TOOLS = ["WebSearch", "WebFetch"];

/**
 * The files condition (the seed pipeline's drafting agents, which read untrusted release notes, pull requests, and
 * package code): read, search, and edit files in the working folder, and nothing else. No shell, no web, no MCP.
 * Nothing is pre-approved (an allow rule for Read would approve any path), so anything outside the folder is refused.
 * Reads of the process's own environment and of system folders are also denied outright, as a second layer, because in
 * CI the run's environment holds the API key.
 */
export const FILE_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"];
export const FILE_DENY = ["Read(//proc/**)", "Read(//sys/**)", "Read(//etc/**)", "Read(//run/**)", "Read(//dev/**)"];

/**
 * The command-line arguments for one condition. Exported for tests. The prompt goes to stdin, not here: a judge
 * prompt carries a whole answer, and Windows refuses command lines over 32,767 characters (spawn ENAMETOOLONG).
 */
export function claudeArgs(o: RunOptions, mcpConfigPath?: string): string[] {
  const project = o.allowEdits ? [...FILE_TOOLS, ...WEB_TOOLS] : ["Read", "Glob", "Grep", ...WEB_TOOLS, "Bash"];
  const tools = o.condition === "none" ? [] : o.condition === "project" ? project : o.condition === "files" ? FILE_TOOLS : WEB_TOOLS;
  // files: nothing is pre-approved, so reads and edits are accepted only inside the working folder (acceptEdits for edits),
  // and anything outside it is refused under -p, whatever the tool (Read, Glob, Grep, Edit, Write).
  const allowed = o.condition === "ludion" ? [...WEB_TOOLS, "mcp__ludion__ludion_ask"] : o.condition === "project" ? projectTools(o.allowEdits === true) : o.condition === "files" ? [] : tools;
  const args = [
    "-p",
    "--output-format", "stream-json", "--verbose",
    "--model", o.model,
    "--max-turns", String(o.maxTurns),
    "--max-budget-usd", String(o.maxBudgetUsd),
    "--no-session-persistence",
    // Only this folder's settings (there are none): no user settings, plugins, hooks, or MCP servers.
    "--setting-sources", "project",
    "--strict-mcp-config",
    "--tools", tools.length ? tools.join(",") : "",
  ];
  if (allowed.length) args.push("--allowedTools", allowed.join(","));
  if ((o.condition === "project" && o.allowEdits) || o.condition === "files") args.push("--permission-mode", "acceptEdits");
  if (o.condition === "files" || o.condition === "project") args.push("--restricted", "--disallowedTools", FILE_DENY.join(","));
  if (mcpConfigPath) args.push("--mcp-config", mcpConfigPath);
  if (o.appendSystemPrompt) args.push("--append-system-prompt", o.appendSystemPrompt);
  return args;
}

/** Pull the answer, tool calls, MCP status, cost, and turns out of stream-json lines. Exported for tests. */
export function parseStream(lines: string[]): Omit<AgentRun, "condition" | "model" | "log"> {
  // An error until a result line says otherwise: a run killed or cut short never prints one.
  const out = { answer: "", toolCalls: [] as string[], mcpServers: {} as Record<string, string>, costUsd: 0, turns: 0, isError: true };
  for (const line of lines) {
    let m: any;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type === "system" && m.subtype === "init") {
      for (const s of m.mcp_servers ?? []) out.mcpServers[s.name] = s.status;
    }
    if (m.type === "assistant") {
      for (const c of m.message?.content ?? []) {
        if (c.type === "tool_use" || c.type === "server_tool_use") out.toolCalls.push(c.name);
      }
    }
    if (m.type === "result") {
      out.answer = typeof m.result === "string" ? m.result : "";
      out.costUsd = Number(m.total_cost_usd ?? 0);
      out.turns = Number(m.num_turns ?? 0);
      out.isError = Boolean(m.is_error) || m.subtype !== "success";
    }
  }
  return out;
}

export function runAgent(prompt: string, o: RunOptions): Promise<AgentRun> {
  const dir = mkdtempSync(join(tmpdir(), "ludion-bench-"));
  const work = join(dir, "work");
  mkdirSync(work);
  if (o.project) cpSync(o.project, work, { recursive: true });
  if (o.claudeMd) writeFileSync(join(work, "CLAUDE.md"), o.claudeMd + "\n");
  const command = trustedCommand("claude", work, runEnv(process.env, o.condition));
  o.prepare?.(work);
  let mcpConfigPath: string | undefined;
  if (o.condition === "ludion") {
    mcpConfigPath = join(dir, "mcp.json");
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { ludion: { type: "http", url: o.ludionUrl ?? "https://ludion.ai/mcp" } } }));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, claudeArgs(o, mcpConfigPath), { cwd: work, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: command.env });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    // A run that hangs (seen under rate limiting) is killed and counted as an error, so the batch moves on.
    const timer = setTimeout(() => child.kill(), o.timeoutMs ?? 10 * 60_000);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      const log = stdout.split(/\r?\n/).filter(Boolean);
      if (log.length === 0) return reject(new Error(`claude printed nothing. stderr: ${stderr.slice(0, 500)}`));
      resolve({ condition: o.condition, model: o.model, ...parseStream(log), log });
    });
  });
}
