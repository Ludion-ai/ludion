// The supported source profile is explicit. Dependencies, credentials and assistant delivery are separate.
import { lstatSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { boundedText } from "./bounded-file.ts";

export type ProjectFiles = Record<string, string>;
export const SOURCE_PROFILE = "bench-source-v1";
const MAX_FILES = 64;
const MAX_BYTES = 512 * 1024;
const excluded = new Set(["node_modules", ".git", ".claude", ".ludion", ".cursor", ".venv", "__pycache__", "dist", "coverage", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "CLAUDE.md", "AGENTS.md", ".gitignore", ".npmrc", ".env"]);
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".json", ".jsonc", ".toml", ".yaml", ".yml", ".css", ".html", ".txt", ".md", ".sql", ".py", ".sh"]);
const excludedName = (p: string) => excluded.has(p) || p.startsWith(".env.");

export function checkedFiles(files: ProjectFiles): ProjectFiles {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("Candidate files must be a source map.");
  let bytes = 0;
  if (Object.keys(files).length > MAX_FILES) throw new Error("Too many candidate files.");
  for (const [path, text] of Object.entries(files)) {
    if (!/^[A-Za-z0-9_.@/-]{1,240}$/.test(path) || path.split("/").some((p) => !p || p === "." || p === ".." || excludedName(p)) || !extensions.has(extname(path)) || typeof text !== "string" || !text.isWellFormed()) throw new Error("Invalid or unsupported candidate path or text.");
    bytes += Buffer.byteLength(text);
    if (bytes > MAX_BYTES) throw new Error("Candidate files are too large.");
  }
  return files;
}

export function snapshotProject(dir: string): ProjectFiles {
  const files: ProjectFiles = Object.create(null);
  let visited = 0;
  const visit = (rel: string) => {
    if (++visited > 256 || rel.split("/").length > 16) throw new Error("Candidate source tree is too large or too deep.");
    const path = join(dir, rel);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) throw new Error("Candidate snapshots must not contain symbolic links.");
    if (st.isDirectory()) {
      for (const name of readdirSync(path)) if (!excludedName(name)) visit(rel ? `${rel}/${name}` : name);
    } else if (st.isFile()) {
      if (!extensions.has(extname(path))) throw new Error(`Unsupported source file: ${rel}. No complete snapshot was captured.`);
      if (st.size > MAX_BYTES) throw new Error("Candidate file is too large.");
      files[rel] = boundedText(path, MAX_BYTES);
      checkedFiles(files);
    } else throw new Error("Candidate snapshots must contain only regular files and directories.");
  };
  visit("");
  return checkedFiles(files);
}
