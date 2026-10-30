import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Runs git in a test repository and returns its output. */
export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Commits every file of `root` (a new repository if it is not one yet) and returns the commit. */
export function commit(root: string): string {
  if (!existsSync(join(root, ".git"))) git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", "fixture");
  return git(root, "rev-parse", "HEAD");
}
