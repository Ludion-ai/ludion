// Reject malformed bounds and mixed-condition resumes before any model process starts.
export interface RunIdentity { label: string; model: string; sync: boolean; site: string | null; offline: boolean; sync_cli_sha256: string | null; harness_sha: string; inputs_sha256: string }
export function runBounds(label: string, trialsText: string, capText: string, runModel: boolean) {
  if (!runModel) throw new Error("Model measurement is opt-in: add --run-model only when the measurement is authorized.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) throw new Error("Use a simple run label, without paths.");
  const trials = Number(trialsText);
  const cap = Number(capText);
  if (!trialsText.trim() || !Number.isSafeInteger(trials) || trials < 1 || !capText.trim() || !Number.isFinite(cap) || cap < 0) throw new Error("Trials must be a positive integer and cap-usd a finite nonnegative number.");
  return { trials, cap };
}
export function resumeRows(raw: unknown, identity: RunIdentity): Record<string, unknown>[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid saved measurement.");
  const data = raw as Record<string, unknown>;
  if (data.format !== 2) throw new Error("Legacy results lack full run identity; preserve them and use a new label.");
  if (Object.entries(identity).some(([k, v]) => data[k] !== v) || !Array.isArray(data.rows)) throw new Error("Saved measurement condition differs; use a new label instead of mixing runs.");
  const seen = new Set<string>();
  for (const row of data.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !/^[a-z0-9][a-z0-9.-]{0,119}$/.test(row.id) || !Number.isSafeInteger(row.trial) || row.trial < 1 || typeof row.costUsd !== "number" || !Number.isFinite(row.costUsd) || row.costUsd < 0) throw new Error("Invalid saved trial or cost; spending state is unknown.");
    const key = `${row.id}#${row.trial}`;
    if (seen.has(key)) throw new Error("Duplicate saved trial; spending state is unknown.");
    seen.add(key);
  }
  return data.rows;
}
export function nextRunBudget(cap: number, spent: number): number {
  if (!Number.isFinite(cap) || cap < 0 || !Number.isFinite(spent) || spent < 0) throw new Error("Spending state is unknown.");
  return Math.max(0, Math.min(2, cap - spent));
}
export function reportedCost(log: string[]): number | undefined {
  let result: unknown;
  for (const line of log) {
    try { const item = JSON.parse(line); if (item?.type === "result") result = item.total_cost_usd; } catch { /* non-result line */ }
  }
  return typeof result === "number" && Number.isFinite(result) && result >= 0 ? result : undefined;
}
