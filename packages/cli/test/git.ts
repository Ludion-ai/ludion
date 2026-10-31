import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Runs git in a test repository and returns its output. */
export function git(cwd: string, ...args: string[]): string {
  return run(cwd, args);
}

function run(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const result = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "-c", "init.defaultBranch=main", ...args], { cwd, encoding: "utf8", env });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/**
 * Commits every file of `root` (a new repository if it is not one yet) and returns the commit. With `date` (Git's
 * date form, such as "@1767225635 +0000") as both the author and the committer date, the same files always give the
 * same commit id; without it the id changes with the clock.
 */
export function commit(root: string, date?: string): string {
  if (!existsSync(join(root, ".git"))) git(root, "init", "-q");
  git(root, "add", "-A");
  run(root, ["commit", "-q", "--allow-empty", "-m", "fixture"], date === undefined ? undefined : { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(root, "rev-parse", "HEAD");
}
