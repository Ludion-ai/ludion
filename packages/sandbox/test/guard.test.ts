// The repository guard on starting containers. It lives in packages/sandbox, a protected path, so changing
// which files may start a container needs the same independent review as changing the sandbox flags.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));

interface ScanFile {
  path: string;
  text: string;
}

interface ScanHit {
  path: string;
  line: number;
  reason: "run argv" | "exec docker run" | "docker spawn";
}

const RUN_ARGV = /\[\s*["']run["']|\.push\(\s*["']run["']|`run`|`run /;
const DOCKER_SPAWN = /(?:spawnSync|execFileSync|spawn|execFile)\(\s*["']docker["']/;
const DOCKER_EXEC = /\bexec(?:Sync)?\(\s*[`'"][^`'"]*docker run/;

/** The only files that may spawn docker, each with the one function allowed to build a `run` argv. */
const RUN_BUILDERS: Readonly<Record<string, string>> = {
  "packages/sandbox/src/docker.ts": "runArgs",
};

/** Repo-relative posix path. Synthetic scan files are already relative; the source tree is absolute. */
function repoPath(path: string): string {
  return relative(REPO, resolve(REPO, path)).replaceAll("\\", "/");
}

function isDockerSource(path: string): boolean {
  return Object.hasOwn(RUN_BUILDERS, repoPath(path));
}

/**
 * Start and end offsets of a top-level `export function <name>(`: from the line that declares it to its closing
 * `}` at column 0. A mention in a comment or a later helper does not count as part of the function.
 */
function exportedFunction(src: string, name: string): { at: number; end: number } {
  const start = new RegExp(`^export function ${name}\\(`, "m").exec(src);
  if (!start) throw new Error(`export function ${name} not found`);
  const close = /\n\}\r?(?:\n|$)/.exec(src.slice(start.index));
  if (!close) throw new Error(`export function ${name} has no closing brace at column 0`);
  return { at: start.index, end: start.index + close.index + 2 };
}

/** Literal argv a builder file may pass to a docker spawn: none of these start a container. */
const BUILDER_SPAWN_LITERALS = new Set(["kill", "pull", "version"]);
const DOCKER_SPAWN_LITERAL = /(?:spawnSync|execFileSync|spawn|execFile)\(\s*["']docker["']\s*,\s*\[\s*["']([^"']*)["']/;

/** A docker version probe does not start a container. Every other docker spawn outside a builder file is a hit. */
function isVersionProbe(line: string): boolean {
  return /(?:spawnSync|execFileSync|spawn|execFile)\(\s*["']docker["']\s*,\s*\[\s*["']version["']/.test(line);
}

/**
 * Files other than the RUN_BUILDERS files must not spawn docker or build a `run` argv.
 * A builder file may spawn docker with a computed argv (from its builder function) or a literal kill, pull or version.
 * A literal `run` argv in a builder file is reported so the caller can require it to sit in that function.
 * Any other literal docker argv, and any exec of `docker run`, is a hit in every file.
 * `packages/cli` `docker version` is allowed: it does not start a container.
 */
function scanDockerSources(files: readonly ScanFile[]): ScanHit[] {
  const hits: ScanHit[] = [];
  for (const file of files) {
    const dockerFile = isDockerSource(file.path);
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const base = { path: file.path, line: i + 1 };
      if (dockerFile) {
        if (RUN_ARGV.test(line)) hits.push({ ...base, reason: "run argv" });
        if (DOCKER_EXEC.test(line)) hits.push({ ...base, reason: "exec docker run" });
        const literal = DOCKER_SPAWN_LITERAL.exec(line)?.[1];
        if (literal !== undefined && !BUILDER_SPAWN_LITERALS.has(literal)) hits.push({ ...base, reason: "docker spawn" });
        continue;
      }
      if (RUN_ARGV.test(line)) hits.push({ ...base, reason: "run argv" });
      if (DOCKER_EXEC.test(line)) hits.push({ ...base, reason: "exec docker run" });
      if (DOCKER_SPAWN.test(line) && !isVersionProbe(line)) hits.push({ ...base, reason: "docker spawn" });
    }
  }
  return hits;
}

function sourceTree(): ScanFile[] {
  const files: ScanFile[] = [];
  // The whole repository's script sources. Unit test folders hold the synthetic cases below; build output and
  // installed packages are not ours (dist/ bundles the sandbox itself).
  const skip = new Set(["node_modules", ".git", "dist", ".astro", ".wrangler", "test", "tests", "test-results", "playwright-report"]);
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.[cm]?[jt]s$/.test(name) && !/\.test\.[cm]?[jt]s$/.test(name)) files.push({ path, text: readFileSync(path, "utf8") });
    }
  };
  walk(REPO);
  return files;
}

describe("docker run construction", () => {
  it("starts a run argument list only inside a builder function", () => {
    const tree = sourceTree();
    // The scan reaches scripts outside packages: plain JavaScript, root config and the repository's tools.
    for (const path of ["tools/check-production.ts", "playwright.config.ts", ".claude/hooks/guard.mjs", "packages/cli/build.ts"]) {
      expect(tree.some((file) => repoPath(file.path) === path), path).toBe(true);
    }
    const hits = scanDockerSources(tree);
    expect(hits.filter((hit) => !isDockerSource(hit.path))).toEqual([]);
    for (const [path, name] of Object.entries(RUN_BUILDERS)) {
      const text = readFileSync(join(REPO, path), "utf8");
      const builder = exportedFunction(text, name);
      expect(text.slice(builder.at, builder.end)).toMatch(/\[\s*"run"/);
      for (const hit of hits.filter((item) => repoPath(item.path) === path)) {
        expect(hit).toMatchObject({ reason: "run argv" });
        const offset = text.split("\n").slice(0, hit.line - 1).join("\n").length;
        expect(offset).toBeGreaterThan(builder.at);
        expect(offset).toBeLessThan(builder.end);
      }
    }
  });

  it("catches a synthetic docker spawn, a run argv, and a template, and allows a version probe", () => {
    const bad = scanDockerSources([
      { path: "tools/verify/src/evil.ts", text: 'spawnSync("docker", ["run", "--rm"]);\n' },
      { path: "packages/cli/src/evil.ts", text: "spawn('docker', ['run']);\n" },
      { path: "packages/cli/src/push.ts", text: 'args.push("run");\n' },
      { path: "packages/cli/src/push2.ts", text: "args.push('run');\n" },
      { path: "packages/cli/src/tmpl.ts", text: "const args = `run --rm`;\nspawnSync(\"docker\", args);\n" },
      { path: "packages/cli/src/bare.ts", text: "const args = `run`;\n" },
      { path: "packages/cli/src/exec.ts", text: "exec(`docker run -it alpine`);\n" },
      { path: "packages/cli/src/execfile.ts", text: 'execFile("docker", ["pull", "alpine"]);\n' },
    ]);
    expect(bad.length).toBeGreaterThanOrEqual(8);
    expect(bad.some((hit) => hit.path.endsWith("bare.ts") && hit.reason === "run argv")).toBe(true);
    expect(bad.some((hit) => hit.path.endsWith("evil.ts") && hit.reason === "docker spawn")).toBe(true);
    expect(bad.some((hit) => hit.reason === "run argv")).toBe(true);
    expect(bad.some((hit) => hit.reason === "exec docker run")).toBe(true);
    expect(scanDockerSources([
      { path: "packages/cli/src/teach.ts", text: 'spawnSync("docker", ["version", "--format", "{{.Server.Version}}"]);\n' },
    ])).toEqual([]);
    expect(scanDockerSources([
      { path: "packages/cli/src/teach.ts", text: 'spawnSync("docker", ["run", "--rm"]);\n' },
    ]).length).toBeGreaterThan(0);
    // The name docker.ts is not an exemption: only the RUN_BUILDERS paths are.
    expect(scanDockerSources([
      { path: "packages/cli/src/security/docker.ts", text: 'spawnSync("docker", ["run", "--rm"]);\n' },
    ]).map((hit) => hit.reason)).toEqual(["run argv", "docker spawn"]);
    expect(scanDockerSources([
      { path: "packages/sandbox/src/docker.ts", text: 'spawn("docker", args, { stdio: "ignore" });\nspawn("docker", ["kill", name]);\n' },
    ])).toEqual([]);
    // A builder file still may not start a container any other way than its builder's argv.
    expect(scanDockerSources([
      { path: "packages/sandbox/src/docker.ts", text: 'spawn("docker", ["container", "run", "--privileged", image]);\n' },
      { path: "packages/sandbox/src/docker.ts", text: 'execSync("docker run --privileged x");\n' },
      { path: "packages/sandbox/src/docker.ts", text: 'spawnSync("docker", ["exec", "x", "sh"]);\n' },
    ]).map((hit) => hit.reason)).toEqual(["docker spawn", "exec docker run", "docker spawn"]);
    // The removed legacy verifier is no longer a builder.
    expect(scanDockerSources([
      { path: "tools/verify/src/docker.ts", text: 'spawnSync("docker", ["run", "--rm"]);\n' },
    ]).map((hit) => hit.reason)).toEqual(["run argv", "docker spawn"]);
  });

  it("bounds a builder function at its own closing brace, not at the next export", () => {
    const text = [
      "// export function runArgs( is only mentioned here",
      "export function runArgs(name: string): string[] {",
      "  if (name) {",
      '    return ["run", name];',
      "  }",
      "  return [];",
      "}",
      "function helper(): string[] {",
      '  return ["run", "--privileged"];',
      "}",
      "export function runContainer(): void {}",
      "",
    ].join("\n");
    const fn = exportedFunction(text, "runArgs");
    expect(text.slice(fn.at, fn.end)).toBe(text.split("\n").slice(1, 7).join("\n"));
    expect(text.indexOf('"--privileged"')).toBeGreaterThan(fn.end);
    expect(() => exportedFunction(text, "missing")).toThrow("not found");
  });
});
