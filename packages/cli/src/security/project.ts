// Paths inside a checkout the judge reads (judge-cli.ts): a real root directory, and regular files under it reached
// without a symbolic link.
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export function rootPath(dir: string): string {
  const root = resolve(dir);
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error("Project root must be a real directory.");
  return realpathSync(root);
}

export function regularFile(root: string, file: string): string {
  if (!file || isAbsolute(file) || file.includes("\\") || file.includes(":")) throw new Error("Expected a project-relative path using forward slashes.");
  const full = resolve(root, file);
  const rel = relative(root, full);
  if (!rel || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Path escapes the project.");
  let cursor = root;
  for (const segment of rel.split(sep)) {
    cursor = join(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("Symlinks are not supported.");
  }
  if (!lstatSync(full).isFile()) throw new Error("Expected a regular project file.");
  return full;
}
