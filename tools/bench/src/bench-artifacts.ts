// Local, private source artifacts. Hashes establish byte integrity, not an authenticated model identity.
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { checkedFiles, SOURCE_PROFILE, type ProjectFiles } from "./project-snapshot.ts";
import { boundedText } from "./bounded-file.ts";
export { boundedText } from "./bounded-file.ts";

export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const hashText = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Artifact contains unsupported JSON data.");
  return text;
}
export const filesHash = (files: ProjectFiles) => hashText(canonicalJson(checkedFiles(files)));
export const taskHash = (task: object) => hashText(canonicalJson(Object.fromEntries(Object.entries(task).filter(([k]) => k !== "overlay"))));
export const artifactDir = () => process.env.LUDION_BENCH_ARTIFACTS || join(homedir(), ".ludion", "bench-artifacts");
const digest = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export interface BenchArtifact {
  format: 1;
  source_profile: typeof SOURCE_PROFILE;
  task_id: string;
  task_sha256: string;
  trial: number;
  model: string;
  sync: boolean;
  site: string | null;
  offline: boolean;
  sync_cli_sha256: string | null;
  harness_sha: string;
  inputs_sha256: string;
  captured_at: string;
  base_files: ProjectFiles;
  candidate_files: ProjectFiles;
  base_sha256: string;
  candidate_sha256: string;
  delivery: { text: string; sha256: string } | null;
}
export interface ArtifactRef { id: string; sha256: string; source_profile: typeof SOURCE_PROFILE }

export function ensureArtifactDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || (process.platform !== "win32" && (st.mode & 0o077))) throw new Error("Choose a real private artifact directory.");
}

export function validateArtifact(raw: unknown): BenchArtifact {
  if (!object(raw) || raw.format !== 1 || raw.source_profile !== SOURCE_PROFILE || typeof raw.task_id !== "string" || !/^[a-z0-9][a-z0-9.-]{0,119}$/.test(raw.task_id) || !digest(raw.task_sha256) || !Number.isSafeInteger(raw.trial) || Number(raw.trial) < 1 || typeof raw.model !== "string" || !/^[a-zA-Z0-9._/-]{1,100}$/.test(raw.model) || typeof raw.sync !== "boolean" || !(raw.site === null || (typeof raw.site === "string" && raw.site.length <= 2048 && !/[\u0000-\u0020\u007f]/.test(raw.site))) || typeof raw.harness_sha !== "string" || !/^[a-f0-9]{40}$/.test(raw.harness_sha) || typeof raw.captured_at !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.captured_at) || !Number.isFinite(Date.parse(raw.captured_at))) throw new Error("Invalid artifact metadata.");
  if (!object(raw.base_files) || !object(raw.candidate_files)) throw new Error("Artifact lacks a complete supported source snapshot.");
  const base = checkedFiles(raw.base_files as ProjectFiles);
  const candidate = checkedFiles(raw.candidate_files as ProjectFiles);
  if (raw.base_sha256 !== filesHash(base) || raw.candidate_sha256 !== filesHash(candidate)) throw new Error("Artifact source digest mismatch.");
  if (raw.delivery !== null && (!object(raw.delivery) || typeof raw.delivery.text !== "string" || !raw.delivery.text.isWellFormed() || Buffer.byteLength(raw.delivery.text) > 512 * 1024 || raw.delivery.sha256 !== hashText(raw.delivery.text))) throw new Error("Invalid artifact delivery context.");
  if (raw.sync !== (raw.delivery !== null) || (!raw.sync && raw.site !== null)) throw new Error("Artifact delivery condition mismatch.");
  if (!digest(raw.inputs_sha256)) throw new Error("Artifact prepared input identity is missing.");
  if (typeof raw.offline !== "boolean" || (!raw.sync && raw.offline) || (raw.sync ? !digest(raw.sync_cli_sha256) : raw.sync_cli_sha256 !== null)) throw new Error("Artifact CLI delivery identity is missing or inconsistent.");
  return raw as unknown as BenchArtifact;
}

export function makeArtifact(meta: Omit<BenchArtifact, "format" | "source_profile" | "captured_at" | "base_sha256" | "candidate_sha256" | "delivery">, delivery: string | null): BenchArtifact {
  return validateArtifact({ ...meta, format: 1, source_profile: SOURCE_PROFILE, captured_at: new Date().toISOString(), base_sha256: filesHash(meta.base_files), candidate_sha256: filesHash(meta.candidate_files), delivery: delivery === null ? null : { text: delivery, sha256: hashText(delivery) } });
}

export function saveArtifact(artifact: BenchArtifact, dir = artifactDir()): ArtifactRef {
  const valid = validateArtifact(artifact);
  const text = JSON.stringify(valid, null, 2) + "\n";
  if (Buffer.byteLength(text) > MAX_ARTIFACT_BYTES) throw new Error("Artifact is too large.");
  ensureArtifactDir(dir);
  const id = randomUUID();
  const path = join(dir, `${id}.json`);
  const temporary = `${path}.tmp`;
  try { writeFileSync(temporary, text, { flag: "wx", mode: 0o600 }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
  return { id, sha256: hashText(text), source_profile: SOURCE_PROFILE };
}

export function readArtifact(path: string, expectedSha256: string): BenchArtifact {
  if (!digest(expectedSha256)) throw new Error("Supply the artifact SHA-256 recorded with the run.");
  const text = boundedText(path);
  if (hashText(text) !== expectedSha256) throw new Error("Artifact file digest mismatch.");
  return validateArtifact(JSON.parse(text));
}
