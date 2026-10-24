// Entry points the P1 Capability runner will call later. Nothing on main runs
// vitest yet. CTO rule: the runner owns argv. An artifact may contribute at most
// a narrow item such as a test-name filter. Config, root, update, allowOnly,
// coverage, and any shell command stay with the runner.
import { isAbsolute } from "node:path";
import { isInside } from "./verifier-deps.ts";

export interface VerifierVitestRequest {
  files: string[];
  testNamePattern?: string;
}

export interface VerifierVitestContext {
  recipientRoot: string;
  verifierRoot: string;
  /** Absolute path of the vitest bin the runner loaded. Not taken from the artifact. */
  vitestPath: string;
  /** Runner-owned config. Omitted when the runner does not pin one. */
  configPath?: string;
}

export interface ArtifactArgv {
  files: string[];
  testNamePattern?: string;
}

const REQUEST_KEYS = new Set(["files", "testNamePattern"]);
const CONTEXT_KEYS = new Set(["recipientRoot", "verifierRoot", "vitestPath", "configPath"]);

/** argv[0] values that are commands, including a path whose basename is one of these. */
const COMMAND_BASENAMES = new Set([
  "sh", "bash", "dash", "zsh", "fish", "busybox",
  "node", "nodejs", "npx", "npm", "pnpm", "yarn", "bun",
  "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
  "sh.exe", "bash.exe", "node.exe", "npm.cmd", "npx.cmd", "pnpm.cmd",
]);

const VITEST_BASENAMES = new Set(["vitest", "vitest.mjs", "vitest.js", "vitest.cjs", "vitest.cmd", "vitest.exe"]);

function reject(token: string): never {
  throw new Error(`Rejected argv token ${JSON.stringify(token)}.`);
}

function assertOnlyKeys(obj: object, allowed: ReadonlySet<string>, label: string): void {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) throw new Error(`Unknown ${label} field ${key}.`);
  }
}

function commandBasename(token: string): string {
  const norm = token.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return (slash === -1 ? norm : norm.slice(slash + 1)).toLowerCase();
}

/** True for a shell, a package manager, or a vitest binary that is not the bare command name `vitest`. */
function isForeignCommand(token: string): boolean {
  if (token === "vitest") return false;
  const base = commandBasename(token);
  if (COMMAND_BASENAMES.has(base) || VITEST_BASENAMES.has(base)) return true;
  // A single argv element such as "sh -c ..." is still a command, not a file filter.
  return /^(?:sh|bash|dash|zsh|node|npx|pnpm|npm|cmd|powershell|pwsh)\b/i.test(token);
}

function isShellToken(token: string): boolean {
  if (/[\0\r\n]/.test(token)) return true;
  const trimmed = token.trim();
  return trimmed === "&&" || trimmed === "||" || trimmed === ";" || trimmed === "|" || trimmed === "&" || trimmed === "|&";
}

function fileProblem(file: string): string | null {
  if (typeof file !== "string" || file.length === 0) return "path is empty";
  if (file !== file.trim()) return "leading or trailing whitespace";
  if (/[\0\r\n]/.test(file)) return "NUL or newline";
  if (file.startsWith("-")) return "leading '-'";
  if (/[;&|]/.test(file)) return "shell metacharacter";
  if (file.startsWith("/") || file.startsWith("\\")) return "absolute path";
  if (/^[A-Za-z]:/.test(file)) return "drive path";
  const parts = file.split(/[/\\]/);
  if (parts.some((part) => part === "" || part === "..")) return "'..' or an empty segment";
  return null;
}

function patternProblem(pattern: string): string | null {
  if (typeof pattern !== "string") return "must be a string";
  if (pattern.length < 1 || pattern.length > 200) return "must be 1..200 characters";
  if (pattern.startsWith("-")) return "must not start with '-'";
  if (/[\0\r\n]/.test(pattern)) return "NUL or newline";
  return null;
}

function assertControlFree(label: string, value: string): void {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty string without a NUL or newline.`);
  }
}

/**
 * Argv the runner executes. Fixed flags are only `--allowOnly=false`: nothing here
 * weakens vitest (no passWithNoTests, no watch, no update, no allowOnly from the artifact).
 * `configPath` is taken only from `ctx`. It must sit inside the verifier root and outside
 * the recipient tree. `vitestPath` must not sit inside the recipient tree.
 *
 * This is the runner's command, not an artifact argv. `validateArtifactArgv` rejects an
 * absolute vitest path on purpose; the runner is the one component allowed to name it.
 */
export function buildVerifierVitestArgv(req: VerifierVitestRequest, ctx: VerifierVitestContext): string[] {
  assertOnlyKeys(req, REQUEST_KEYS, "request");
  assertOnlyKeys(ctx, CONTEXT_KEYS, "context");
  if (!Array.isArray(req.files) || req.files.length === 0) throw new Error("files must be a non-empty list.");
  for (const file of req.files) {
    const problem = fileProblem(file);
    if (problem) throw new Error(`Invalid test file ${JSON.stringify(file)}: ${problem}.`);
  }
  if (req.testNamePattern !== undefined) {
    const problem = patternProblem(req.testNamePattern);
    if (problem) throw new Error(`Invalid testNamePattern ${JSON.stringify(req.testNamePattern)}: ${problem}.`);
  }

  assertControlFree("vitestPath", ctx.vitestPath);
  if (!isAbsolute(ctx.vitestPath) || ctx.vitestPath.startsWith("-")) throw new Error("vitestPath must be an absolute path.");
  if (isInside(ctx.vitestPath, ctx.recipientRoot)) throw new Error("vitestPath must not be inside the recipient tree.");

  const argv: string[] = [ctx.vitestPath];
  argv.push("run", "--allowOnly=false");

  if (ctx.configPath !== undefined) {
    assertControlFree("configPath", ctx.configPath);
    if (!isAbsolute(ctx.configPath) || ctx.configPath.startsWith("-")) throw new Error("configPath must be an absolute path.");
    if (!isInside(ctx.configPath, ctx.verifierRoot)) throw new Error("configPath must be inside the verifier root.");
    if (isInside(ctx.configPath, ctx.recipientRoot)) throw new Error("configPath must not be inside the recipient tree.");
    argv.push("--config", ctx.configPath);
  }
  if (req.testNamePattern !== undefined) argv.push("-t", req.testNamePattern);
  argv.push(...req.files);
  return argv;
}

/**
 * Parse an argv an artifact shipped. Accepts only an optional leading `vitest`, an optional
 * `run`, file filters, and a single `-t <p>` / `--testNamePattern <p>` / `--testNamePattern=<p>`.
 * Every other token throws, and the error names that token. Case variants, combined short
 * flags, trailing whitespace, and a non-vitest command in argv[0] are not the allowlist.
 */
export function validateArtifactArgv(argv: string[]): ArtifactArgv {
  if (!Array.isArray(argv) || argv.some((token) => typeof token !== "string")) {
    throw new Error("Rejected argv token (argv must be an array of strings).");
  }
  if (argv.length === 0) throw new Error("Rejected argv: file list is empty.");

  const head = argv[0];
  if (head === undefined) throw new Error("Rejected argv: file list is empty.");
  if (head !== "vitest" && isForeignCommand(head)) reject(head);

  let index = 0;
  if (head === "vitest") index = 1;
  if (argv[index] === "run") index += 1;

  const files: string[] = [];
  let testNamePattern: string | undefined;
  for (; index < argv.length; index++) {
    const token = argv[index];
    if (token === undefined) break;
    if ((token === "-t" || token === "--testNamePattern") && !isShellToken(token)) {
      if (testNamePattern !== undefined) reject(token);
      const value = argv[index + 1];
      if (value === undefined) reject(token);
      if (patternProblem(value)) reject(value);
      testNamePattern = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--testNamePattern=") && token === token.trim() && !/[\0\r\n]/.test(token)) {
      if (testNamePattern !== undefined) reject(token);
      const value = token.slice("--testNamePattern=".length);
      if (patternProblem(value)) reject(token);
      testNamePattern = value;
      continue;
    }
    if (token.startsWith("-") || isShellToken(token) || isForeignCommand(token)) reject(token);
    const problem = fileProblem(token);
    if (problem) reject(token);
    files.push(token);
  }
  if (files.length === 0) throw new Error("Rejected argv: file list is empty.");
  return testNamePattern === undefined ? { files } : { files, testNamePattern };
}
