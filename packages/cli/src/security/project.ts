import { chmodSync, constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { hash } from "./php.ts";

export const CONFIG = "ludion.security.json";
export type Config = { schema: 1; ecosystem?: "php"; dockerfile: string; test: string[]; timeout_seconds: number };
export type DependencyConfig = { schema: 1; ecosystem: "npm" | "composer" | "maven"; image?: string; test: string[]; timeout_seconds: number };
export const DEFAULT_CONFIG: Config = { schema: 1, dockerfile: "Dockerfile", test: ["php", "tests/smoke.php"], timeout_seconds: 120 };

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

export function readConfig(root: string): Config | DependencyConfig {
  const path = regularFile(root, CONFIG);
  if (lstatSync(path).size > 16 * 1024) throw new Error("Security config exceeds 16 KiB.");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid security config.");
  const c = value as Record<string, unknown>;
  if (c.ecosystem !== undefined && c.ecosystem !== "php") {
    if (!["npm", "composer", "maven"].includes(String(c.ecosystem)) || Object.keys(c).some(k => !["schema", "ecosystem", "image", "test", "timeout_seconds"].includes(k)) || c.schema !== 1 || !Array.isArray(c.test) || !c.test.length || c.test.length > 32 || !c.test.every(a => typeof a === "string" && a.length > 0 && a.length <= 2000 && !a.includes("\0")) || String(c.test[0]).startsWith("-") || !Number.isInteger(c.timeout_seconds) || Number(c.timeout_seconds) < 1 || Number(c.timeout_seconds) > 600 || (c.image !== undefined && (typeof c.image !== "string" || c.image.length > 240))) {
      throw new Error("Expected npm/composer/maven ecosystem, optional official tool image, test argv and timeout_seconds (1–600).");
    }
    return c as DependencyConfig;
  }
  if (Object.keys(c).some(k => !["schema", "ecosystem", "dockerfile", "test", "timeout_seconds"].includes(k)) || c.schema !== 1 || typeof c.dockerfile !== "string" || !Array.isArray(c.test) || !c.test.length || c.test.length > 32 || !c.test.every(a => typeof a === "string" && a.length > 0 && a.length <= 2000 && !a.includes("\0")) || (c.test[0] as string).startsWith("-") || !Number.isInteger(c.timeout_seconds) || Number(c.timeout_seconds) < 1 || Number(c.timeout_seconds) > 600) {
    throw new Error("Expected schema 1, dockerfile, a nonempty test argv, and timeout_seconds (1–600). Unknown options are refused.");
  }
  regularFile(root, c.dockerfile);
  return c as Config;
}

/** A bounded private snapshot. Do not follow links or copy credentials, Git history, or our own receipts. */
export function snapshot(root: string, destination?: string): string {
  let bytes = 0, count = 0;
  const entries: string[] = [];
  function walk(dir: string, rel: string, depth: number) {
    if (depth > 40) throw new Error("Project snapshot exceeds 40 directory levels.");
    for (const name of readdirSync(dir).sort()) {
      if ([".git", ".ludion", "node_modules", ".ssh", ".aws"].includes(name) || name === ".env" || name.startsWith(".env.")) continue;
      if (++count > 10_000) throw new Error("Project snapshot exceeds 10,000 entries.");
      const src = join(dir, name), key = rel ? `${rel}/${name}` : name;
      const stat = lstatSync(src);
      if (stat.isSymbolicLink()) throw new Error(`Snapshot refuses symlink: ${key}`);
      if (stat.isDirectory()) {
        entries.push(`directory\0${key}\0${stat.mode & 0o777}`);
        if (destination) mkdirSync(join(destination, key), { recursive: true });
        walk(src, key, depth + 1);
        if (destination) chmodSync(join(destination, key), stat.mode & 0o777);
      } else {
        if (!stat.isFile() || stat.nlink > 1) throw new Error(`Snapshot refuses non-regular or hard-linked file: ${key}`);
        bytes += stat.size;
        if (bytes > 100 * 1024 * 1024) throw new Error("Project snapshot exceeds 100 MiB.");
        const fd = openSync(src, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let data: Buffer;
        try {
          const opened = fstatSync(fd);
          if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("Project changed while taking snapshot.");
          data = readFileSync(fd);
        } finally { closeSync(fd); }
        entries.push(`file\0${key}\0${stat.mode & 0o777}\0${hash(data)}`);
        if (destination) {
          writeFileSync(join(destination, key), data, { flag: "wx", mode: stat.mode & 0o777 });
          chmodSync(join(destination, key), stat.mode & 0o777);
        }
      }
    }
  }
  walk(root, "", 0);
  return hash(entries.join("\n"));
}

export function privateState(root: string): string {
  let dir = root;
  for (const name of [".ludion", "security"]) {
    dir = join(dir, name);
    if (!existsSync(dir)) mkdirSync(dir, { mode: 0o700 });
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Security state must be a real directory.");
  }
  const transactions = readdirSync(dir).filter(name => name.startsWith("transaction-"));
  if (transactions.length > 1000) throw new Error("Too many update journals; archive completed records before continuing.");
  for (const name of transactions) {
    const path = regularFile(dir, `${name}/journal.json`);
    if (lstatSync(path).size > 64 * 1024) throw new Error("Invalid update journal; manual recovery required.");
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (!journal || !["complete", "rolled_back"].includes(journal.phase)) throw new Error(`Unfinished dependency update requires manual recovery: ${path}`);
  }
  return dir;
}
