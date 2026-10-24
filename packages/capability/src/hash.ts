import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.ts";
import { CapabilityArtifact, CapabilityRecord, Dependencies, Program, Verifier } from "./schema.ts";
import type { CounterexampleT, GuardResultT, StaleReason } from "./schema.ts";

/** `sha256:` plus 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** SHA-256 of file bytes. Content is hashed as UTF-8 with no newline or Unicode normalization. */
export function fileDigest(content: string): string {
  if (!content.isWellFormed()) throw new Error("file content is not well-formed UTF-16");
  const bytes = Buffer.from(content, "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestFiles<T extends { files: Readonly<Record<string, string>> }>(value: T): T {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value.files)) {
    files[path] = fileDigest(content);
  }
  return { ...value, files };
}

export function capabilityId(artifact: unknown): string {
  const parsed = CapabilityArtifact.parse(artifact);
  const body = {
    ...parsed,
    program: digestFiles(parsed.program),
    verifier: digestFiles(parsed.verifier),
  };
  return `cap:${sha256Hex(canonicalJson(body))}`;
}

export function programHash(program: unknown): string {
  return sha256Hex(canonicalJson(digestFiles(Program.parse(program))));
}

export function verifierHash(verifier: unknown): string {
  return sha256Hex(canonicalJson(digestFiles(Verifier.parse(verifier))));
}

export function counterexamplesHash(counterexamples: readonly CounterexampleT[]): string {
  return sha256Hex(canonicalJson(counterexamples));
}

export function dependenciesHash(dependencies: unknown): string {
  return sha256Hex(canonicalJson(Dependencies.parse(dependencies)));
}

export function staleResult(reason: StaleReason, detail: string, condition = "record"): Extract<GuardResultT, { status: "stale" }> {
  return {
    status: "stale",
    reason,
    detail,
    checks: [{ condition, ok: false, note: detail.slice(0, 300) }],
  };
}

/** `{ ok: true }` when `record.id` is the canonical id of `record.artifact`. */
export function verifyRecord(rec: unknown): { ok: true } | Extract<GuardResultT, { status: "stale" }> {
  const parsed = CapabilityRecord.parse(rec);
  if (parsed.id === capabilityId(parsed.artifact)) return { ok: true };
  return staleResult("artifact_hash_mismatch", "record id does not match the canonical artifact hash");
}
