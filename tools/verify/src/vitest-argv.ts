// Entry points the P1 Capability runner will call later. Nothing on main runs
// vitest yet. The runner owns argv. An artifact may contribute at most a narrow
// item such as a test-name filter. Config, root, reporter, output file, update,
// allowOnly, coverage, and any shell command stay with the runner.
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
  /**
   * Absolute path of the runner-owned config shipped at
   * `tools/verify/runner/vitest.runner.config.mjs`. Required. It must sit inside
   * the verifier root and outside the recipient tree.
   */
  configPath: string;
  /** Absolute path of the JSON report. Required. It must sit outside the recipient tree. */
  reportPath: string;
}

export interface ArtifactArgv {
  files: string[];
  testNamePattern?: string;
}

export interface RequiredVitestTest {
  file: string;
  fullName: string;
}

export interface VitestVerdict {
  verdict: "PASS" | "FAIL";
  reasons: string[];
}

const REQUEST_KEYS = new Set(["files", "testNamePattern"]);
const CONTEXT_KEYS = new Set(["recipientRoot", "verifierRoot", "vitestPath", "configPath", "reportPath"]);

/** argv[0] values that are commands, including a path whose basename is one of these. */
const COMMAND_BASENAMES = new Set([
  "sh", "bash", "dash", "zsh", "fish", "busybox",
  "node", "nodejs", "npx", "npm", "pnpm", "yarn", "bun",
  "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe",
  "sh.exe", "bash.exe", "node.exe", "npm.cmd", "npx.cmd", "pnpm.cmd",
]);

const VITEST_BASENAMES = new Set(["vitest", "vitest.mjs", "vitest.js", "vitest.cjs", "vitest.cmd", "vitest.exe"]);

/** ASCII allow-list for a recipient file filter. No spaces, quotes, or shell punctuation. */
const FILE_FILTER = /^[A-Za-z0-9._@+\/-]+$/;

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

/**
 * True when the whole token is a shell, a package tool, or a vitest binary other than
 * the bare command name `vitest`. A file filter such as `node/foo.test.ts` or
 * `bash.test.ts` is not a command: only the basename of the whole token is compared.
 */
function isForeignCommand(token: string): boolean {
  if (token === "vitest") return false;
  const base = commandBasename(token);
  return COMMAND_BASENAMES.has(base) || VITEST_BASENAMES.has(base);
}

function isShellToken(token: string): boolean {
  if (/[\0\r\n]/.test(token)) return true;
  const trimmed = token.trim();
  return trimmed === "&&" || trimmed === "||" || trimmed === ";" || trimmed === "|" || trimmed === "&" || trimmed === "|&";
}

function fileProblem(file: string): string | null {
  if (typeof file !== "string" || file.length === 0) return "path is empty";
  if (file.length > 256) return "longer than 256 characters";
  if (file !== file.trim()) return "leading or trailing whitespace";
  if (/[\0\r\n]/.test(file)) return "NUL or newline";
  if (file.startsWith("-")) return "leading '-'";
  if (file.startsWith("/") || file.startsWith("\\")) return "absolute path";
  if (file.includes("\\")) return "backslash";
  if (file.includes("//")) return "empty segment";
  if (!FILE_FILTER.test(file)) return "character outside the allow-list";
  const parts = file.split("/");
  if (parts.some((part) => part === "" || part === "..")) return "'..' or an empty segment";
  return null;
}

function patternProblem(pattern: string): string | null {
  if (typeof pattern !== "string") return "must be a string";
  if (pattern.length < 1 || pattern.length > 256) return "must be 1..256 characters";
  if (pattern.startsWith("-")) return "must not start with '-'";
  if (/[\0\r\n]/.test(pattern)) return "NUL or newline";
  return null;
}

function assertControlFree(label: string, value: string): void {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty string without a NUL or newline.`);
  }
}

function assertAbsolute(label: string, value: string): void {
  assertControlFree(label, value);
  if (!isAbsolute(value) || value.startsWith("-")) throw new Error(`${label} must be an absolute path.`);
}

/**
 * Argv the runner executes. Fixed flags are only `--allowOnly=false`: nothing here
 * weakens vitest (no passWithNoTests, no watch, no update, no allowOnly from the artifact).
 * `--config`, `--root`, `--reporter`, and `--outputFile` are single argv elements and
 * always come from `ctx`. `configPath` must sit inside the verifier root and outside
 * the recipient tree. `reportPath` must sit outside the recipient tree. `vitestPath`
 * must not sit inside the recipient tree.
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

  assertAbsolute("vitestPath", ctx.vitestPath);
  if (isInside(ctx.vitestPath, ctx.recipientRoot)) throw new Error("vitestPath must not be inside the recipient tree.");

  assertAbsolute("configPath", ctx.configPath);
  if (!isInside(ctx.configPath, ctx.verifierRoot)) throw new Error("configPath must be inside the verifier root.");
  if (isInside(ctx.configPath, ctx.recipientRoot)) throw new Error("configPath must not be inside the recipient tree.");

  assertAbsolute("recipientRoot", ctx.recipientRoot);
  assertAbsolute("reportPath", ctx.reportPath);
  if (isInside(ctx.reportPath, ctx.recipientRoot)) throw new Error("reportPath must not be inside the recipient tree.");

  const argv: string[] = [
    ctx.vitestPath,
    "run",
    "--allowOnly=false",
    `--config=${ctx.configPath}`,
    `--root=${ctx.recipientRoot}`,
    "--reporter=json",
    `--outputFile=${ctx.reportPath}`,
  ];
  if (req.testNamePattern !== undefined) argv.push(`--testNamePattern=${req.testNamePattern}`);
  argv.push(...req.files);
  return argv;
}

/**
 * Parse an argv an artifact shipped. Accepts only an optional leading `vitest`, an optional
 * an optional run subcommand, file filters, and one -t or --testNamePattern value.
 * Every other token throws, and the error names that token. Case variants, combined short
 * flags, trailing whitespace, and a non-vitest command in argv[0] are not the allowlist.
 * `--reporter` and `--outputFile` are runner-owned and rejected here.
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

/**
 * Match `required.file` to a report file path by a normalized suffix.
 * Both sides convert `\` to `/` and drop a trailing slash. `required.file` is the
 * artifact's relative path (`src/a.test.ts`), not a host path. It matches when the
 * report path equals that relative path, or ends with `/` plus that relative path,
 * so a drive-letter prefix or a checkout directory does not have to be known.
 * Comparison is case-sensitive and stops on a segment boundary (`foo-src/a.test.ts`
 * does not match `src/a.test.ts`).
 */
function reportFileMatches(requiredFile: string, reportName: string): boolean {
  const want = requiredFile.replace(/\\/g, "/").replace(/\/+$/g, "").replace(/^\.\//, "");
  const got = reportName.replace(/\\/g, "/").replace(/\/+$/g, "");
  if (want.length === 0 || want.startsWith("/") || want.split("/").some((part) => part === "" || part === "." || part === "..")) return false;
  return got === want || got.endsWith(`/${want}`);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function reportShapeProblem(report: unknown): string | null {
  if (typeof report !== "object" || report === null || Array.isArray(report)) return "Vitest report is not a JSON reporter object.";
  const record = report as Record<string, unknown>;
  const counts = ["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests"] as const;
  for (const key of counts) {
    if (typeof record[key] !== "number" || !Number.isFinite(record[key])) return "Vitest report is not a JSON reporter object.";
  }
  if (typeof record.success !== "boolean" || !Array.isArray(record.testResults)) return "Vitest report is not a JSON reporter object.";
  for (const file of record.testResults) {
    if (typeof file !== "object" || file === null || Array.isArray(file)) return "Vitest report is not a JSON reporter object.";
    const entry = file as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.status !== "string" || !Array.isArray(entry.assertionResults)) {
      return "Vitest report is not a JSON reporter object.";
    }
    for (const assertion of entry.assertionResults) {
      if (typeof assertion !== "object" || assertion === null || Array.isArray(assertion)) return "Vitest report is not a JSON reporter object.";
      const test = assertion as Record<string, unknown>;
      if (typeof test.fullName !== "string" || typeof test.title !== "string" || typeof test.status !== "string" || !isStringArray(test.ancestorTitles)) {
        return "Vitest report is not a JSON reporter object.";
      }
    }
  }
  return null;
}

/**
 * Judge a vitest 4 JSON reporter document (the Jest-compatible shape: counts, `success`,
 * and `testResults[].assertionResults[]`). PASS only when `success` is true, no test
 * failed, at least one test passed or failed (a filter that matches nothing is a failure),
 * and every required test is present with status exactly `passed`. Skipped, pending, todo,
 * failed, and filtered-out tests fail the run. An empty required list fails.
 * Reasons name the relative file and the full name. They do not include the report path.
 */
export function judgeVitestReport(report: unknown, required: readonly RequiredVitestTest[]): VitestVerdict {
  const reasons: string[] = [];
  const shape = reportShapeProblem(report);
  if (shape) return { verdict: "FAIL", reasons: [shape] };
  if (!Array.isArray(required)) return { verdict: "FAIL", reasons: ["Required test list is empty."] };
  const record = report as {
    success: boolean;
    numPassedTests: number;
    numFailedTests: number;
    testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
  };
  if (record.success !== true) reasons.push("Vitest report success is not true.");
  if (record.numFailedTests > 0) reasons.push("Vitest report has failed tests.");
  if (record.numPassedTests + record.numFailedTests === 0) reasons.push("Vitest report ran no tests.");
  if (required.length === 0) reasons.push("Required test list is empty.");
  for (const test of required) {
    if (!test || typeof test.file !== "string" || test.file.length === 0 || typeof test.fullName !== "string" || test.fullName.length === 0) {
      reasons.push("Required test is missing a file or fullName.");
      continue;
    }
    let status: string | undefined;
    for (const file of record.testResults) {
      if (!reportFileMatches(test.file, file.name)) continue;
      const found = file.assertionResults.find((assertion) => assertion.fullName === test.fullName);
      if (found) status = found.status;
    }
    if (status === undefined) reasons.push(`Required test ${test.file} ${JSON.stringify(test.fullName)} is missing.`);
    else if (status !== "passed") reasons.push(`Required test ${test.file} ${JSON.stringify(test.fullName)} is ${status}, not passed.`);
  }
  return reasons.length === 0 ? { verdict: "PASS", reasons: [] } : { verdict: "FAIL", reasons };
}
