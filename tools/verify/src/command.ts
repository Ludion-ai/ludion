// Never let a project supply the host executable that is meant to inspect or sandbox it.
import { execFileSync, spawnSync, type ExecFileSyncOptions, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type Tool = "git" | "gh" | "docker" | "claude";
const tools = new Set<Tool>(["git", "gh", "docker", "claude"]);
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return !rel || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};
function projectRoots(dir: string): string[] {
  const start = realpathSync(dir);
  const roots = [start];
  for (let path = start; ; path = dirname(path)) {
    if (lstatSync(join(path, ".git"), { throwIfNoEntry: false })) roots.push(path);
    if (dirname(path) === path) return roots;
  }
}

/** Absolute PATH entries outside both caller/project roots; no cwd fallback or project npm bins. */
export function trustedCommand(tool: Tool, cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): { file: string; env: NodeJS.ProcessEnv } {
  if (!tools.has(tool)) throw new Error("Unsupported host tool.");
  const roots = [...projectRoots(process.cwd()), ...projectRoots(resolve(cwd))];
  const path = env.PATH ?? env.Path ?? "";
  const directories: string[] = [];
  for (let dir of path.split(delimiter)) {
    dir = dir.replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(dir)) continue;
    try {
      const actual = realpathSync(dir);
      const normalized = actual.replaceAll("\\", "/").toLowerCase();
      if (roots.some((root) => inside(root, actual)) || /(?:^|\/)node_modules\/\.bin(?:\/|$)/.test(normalized)) continue;
      if (statSync(actual).isDirectory() && !directories.includes(actual)) directories.push(actual);
    } catch { /* Missing/unreadable search entries cannot supply a trusted tool. */ }
  }
  const childEnv = { ...env };
  for (const key of Object.keys(childEnv)) if (key.toLowerCase() === "path") delete childEnv[key];
  childEnv.PATH = directories.join(delimiter);
  const suffixes = process.platform === "win32" ? [".exe", ".com"] : [""];
  for (const dir of directories) for (const suffix of suffixes) {
    try {
      const candidate = join(dir, `${tool}${suffix}`);
      const file = realpathSync(candidate);
      if (roots.some((root) => inside(root, file)) || !statSync(file).isFile()) continue;
      accessSync(file, constants.X_OK);
      // Global dispatch shims (e.g. snap) use their invocation name; validate the target but retain that name.
      return { file: candidate, env: childEnv };
    } catch { /* Keep searching global PATH. */ }
  }
  const error = new Error(`Trusted ${tool} was not found outside project directories. Install it on a global PATH.`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  throw error;
}

/** Preserve spawnSync's missing-tool failure contract for callers that deliberately support absent tools. */
export function spawnTool(tool: Tool, args: string[], options: Omit<SpawnSyncOptions, "shell" | "encoding"> = {}): SpawnSyncReturns<string> {
  try {
    const cwd = typeof options.cwd === "string" ? options.cwd : options.cwd ? fileURLToPath(options.cwd) : process.cwd();
    const command = trustedCommand(tool, cwd, options.env ?? process.env);
    return spawnSync(command.file, args, { ...options, env: command.env, encoding: "utf8", shell: false, windowsHide: true });
  } catch (error) {
    return { pid: 0, output: [], stdout: "", stderr: "", status: null, signal: null, error: error as Error };
  }
}

export function execTool(tool: Tool, args: string[], options: Omit<ExecFileSyncOptions, "shell" | "encoding"> = {}): string {
  const cwd = typeof options.cwd === "string" ? options.cwd : options.cwd ? fileURLToPath(options.cwd) : process.cwd();
  const command = trustedCommand(tool, cwd, options.env ?? process.env);
  return execFileSync(command.file, args, { ...options, env: command.env, encoding: "utf8", shell: false, windowsHide: true });
}
