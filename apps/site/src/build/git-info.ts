import type { GitInfo } from "@ludion/core";

const RECORD = "\x1e";
const FIELD = "\x1f";
/** `git log` format for parseAddedLog: one record per commit, then the files it added. */
export const ADDED_LOG_FORMAT = `${RECORD}%cI${FIELD}%s`;

/** `git log` format for parseDeletedLog: the commit hash too, to read the file as it was before. */
export const DELETED_LOG_FORMAT = `${RECORD}%H${FIELD}%cI${FIELD}%s`;

export interface Deletion {
  path: string;
  /** The commit that deleted the file; the lesson is read from its parent. */
  commit: string;
  retracted_at: string;
  pr: number | null;
}

/**
 * Parse `git log --diff-filter=D --name-only --format=<DELETED_LOG_FORMAT> -- lessons/`: for each lesson file ever
 * deleted (a retraction), the newest commit that deleted it.
 */
export function parseDeletedLog(log: string): Record<string, Deletion> {
  const out: Record<string, Deletion> = {};
  for (const record of log.split(RECORD)) {
    const [header = "", ...files] = record.split("\n").filter((l) => l.trim() !== "");
    const [commit, date, subject = ""] = header.split(FIELD);
    if (!commit || !date) continue;
    const pr = /\(#(\d+)\)\s*$/.exec(subject);
    for (const file of files) {
      const path = file.trim();
      const m = /^lessons\/[^/]+\/([0-9A-HJKMNP-TV-Z]{26})\.json$/.exec(path);
      if (m && !(m[1]! in out)) out[m[1]!] = { path, commit, retracted_at: new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z"), pr: pr ? Number(pr[1]) : null };
    }
  }
  return out;
}

/**
 * Parse `git log --diff-filter=A --name-only --format=<ADDED_LOG_FORMAT> -- lessons/` into GitInfo:
 * for each lesson, the commit that added it. Squash merges end their subject with "(#<number>)".
 * Log order is newest first, so the first commit seen for a file is its latest addition.
 */
export function parseAddedLog(log: string): GitInfo {
  const info: GitInfo = {};
  for (const record of log.split(RECORD)) {
    const [header = "", ...files] = record.split("\n").filter((l) => l.trim() !== "");
    const [date, subject = ""] = header.split(FIELD);
    if (!date) continue;
    const verified_at = new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");
    const pr = /\(#(\d+)\)\s*$/.exec(subject);
    for (const file of files) {
      const m = /^lessons\/[^/]+\/([0-9A-HJKMNP-TV-Z]{26})\.json$/.exec(file.trim());
      if (m && !(m[1]! in info)) info[m[1]!] = { verified_at, pr: pr ? Number(pr[1]) : null };
    }
  }
  return info;
}
