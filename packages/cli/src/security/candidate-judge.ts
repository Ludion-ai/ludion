// The judge on `ludion patch`'s npm candidates (docs/status.md, "Missing before complete", 3): the same judge() and the
// same live facts as `ludion judge`, over every package in the diff from the project's package-lock.json to the
// candidate's. Only "ready_except_build" lets the patch go on to its baseline and candidate tests; a candidate that
// must wait is not applied before the wait ends, and one that stops or cannot be judged is not applied.
import { textFile } from "./inventory.ts";
import { judge, type FixedAdvisory, type Judgement, type VersionFacts } from "./judge.ts";
import { packageLockInputs } from "./judge-cli.ts";
import { gatherFacts } from "./npm-facts.ts";

/** `ludion patch` has no production/dev split (docs/status.md, "Waiting for the owner", 2). */
export const NO_SPLIT = "No production/dev split in `ludion patch`: every changed version counts as production.";

/** Judge the change from `before` (the project) to `after` (the candidate), each a folder with package.json and package-lock.json. */
export async function judgeNpmCandidate(before: string, after: string, fetchFn: typeof fetch = fetch, now = new Date()): Promise<Judgement> {
  const read = (dir: string) => ({ manifest: textFile(dir, "package.json"), lock: textFile(dir, "package-lock.json") });
  const a = read(before), b = read(after);
  const lock = packageLockInputs({ before: a.lock, after: b.lock }, { before: a.manifest, after: b.manifest });
  const changes = lock.changes.map(c => ({ ...c, dev: false }));
  let facts = new Map<string, VersionFacts>(), fixes: FixedAdvisory[] = [], created = new Map<string, string | null>(), errors: string[] = [];
  try { ({ facts, fixes, created } = await gatherFacts(changes, fetchFn, lock.entries.map(e => ({ name: e.name, version: e.version })))); } catch (error) { errors = [error instanceof Error ? error.message : String(error)]; facts = new Map(); }
  const files = [a.manifest === b.manifest ? null : "package.json", a.lock === b.lock ? null : "package-lock.json"].filter((f): f is string => f !== null);
  const judgement = judge({ ...lock, changes, facts, fixes, created, errors, files, now });
  return { ...judgement, findings: [{ gate: 1, effect: "info", message: NO_SPLIT }, ...judgement.findings] };
}

/** Why the patch must not go on with the candidate, or null when the judge found nothing and the wait is over. */
export function candidateRefusal(j: Judgement): string | null {
  if (j.verdict === "ready_except_build") return null;
  if (j.verdict === "wait") return `The judge's wait is not over: not applied before ${j.wait_until} (urgency ${j.urgency}, ${j.wait_hours}h from the newest publish, ${j.newest_publish}). Run the patch again after it.`;
  const stops = j.findings.filter(f => f.effect === "stop");
  const reasons = stops.length ? stops : j.findings.filter(f => f.message !== NO_SPLIT);
  return `The judge ${j.verdict === "stop" ? "stops" : "cannot decide on"} the candidate: ${reasons.slice(0, 5).map(f => `gate ${f.gate}: ${f.message}`).join(" ")}${reasons.length > 5 ? ` (${reasons.length - 5} more in the receipt)` : ""}`;
}
