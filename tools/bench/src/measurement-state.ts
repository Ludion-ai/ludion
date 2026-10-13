// Charges belong to attempts, not grades. A crash/unknown charge must never resurrect the full budget.
import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { boundedText } from "./bounded-file.ts";
import { resumeRows, type RunIdentity } from "./task-run-input.ts";

export interface Attempt { id: string; task_id: string; trial: number; status: "pending" | "complete" | "unknown"; costUsd: number | null }
export interface MeasurementState extends RunIdentity { format: 2; trials: number; correct: number; runs: number; spentUsd: number; rows: Record<string, unknown>[]; attempts: Attempt[] }
export function spentOn(attempts: Attempt[]): number {
  const total = attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? 0), 0);
  if (!Number.isFinite(total)) throw new Error("Spending state is unknown.");
  return total;
}
export function resumeState(raw: unknown, identity: RunIdentity): { rows: Record<string, unknown>[]; attempts: Attempt[]; spent: number } {
  const rows = resumeRows(raw, identity);
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.attempts)) throw new Error("Attempt ledger is missing; spending state is unknown.");
  const attempts = data.attempts as Attempt[];
  const seen = new Map<string, Attempt>();
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== "object" || !/^[a-f0-9-]{36}$/.test(attempt.id) || seen.has(attempt.id) || typeof attempt.task_id !== "string" || !/^[a-z0-9][a-z0-9.-]{0,119}$/.test(attempt.task_id) || !Number.isSafeInteger(attempt.trial) || attempt.trial < 1 || !["pending", "complete", "unknown"].includes(attempt.status)) throw new Error("Invalid attempt ledger; spending state is unknown.");
    if (attempt.status !== "complete" || typeof attempt.costUsd !== "number" || !Number.isFinite(attempt.costUsd) || attempt.costUsd < 0) throw new Error("Unfinished or unknown-cost attempt; spending state is unknown. Reconcile it before resuming.");
    seen.set(attempt.id, attempt);
  }
  const spent = spentOn(attempts);
  if (data.spentUsd !== spent) throw new Error("Saved spending total disagrees with attempts; spending state is unknown.");
  for (const row of rows) {
    const attempt = seen.get(String(row.attempt_id));
    if (!attempt || attempt.task_id !== row.id || attempt.trial !== row.trial || attempt.costUsd !== row.costUsd) throw new Error("Grade has no matching charged attempt; spending state is unknown.");
  }
  return { rows, attempts, spent };
}
export function saveState(path: string, state: MeasurementState): void {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error("Measurement state must not be a symbolic link.");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { flag: "wx", mode: 0o600 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
export const readState = (path: string, identity: RunIdentity) => resumeState(JSON.parse(boundedText(path)), identity);

// Hold ownership before reading the ledger and through every model attempt and final save.
// A crashed process leaves a lock: reconciliation, not guessing from PID reuse, permits resume.
export async function withMeasurementLock<T>(path: string, run: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  let descriptor: number;
  try { descriptor = openSync(lockPath, "wx", 0o600); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Measurement is locked. Confirm the previous process has stopped and reconcile pending charges before removing its lock.");
    throw err;
  }
  const token = `${process.pid}:${randomUUID()}\n`;
  try {
    writeFileSync(descriptor, token);
    return await run();
  } finally {
    closeSync(descriptor);
    // Never delete a replacement lock belonging to another invocation.
    if (boundedText(lockPath, 1024) !== token) throw new Error("Measurement lock ownership changed; reconcile state before resuming.");
    rmSync(lockPath);
  }
}
