import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.ts";
import type { CapabilityArtifactT, CapabilityRecordT, CounterexampleT, DependenciesT, GuardResultT, ProgramT, StaleReason, VerifierT } from "./schema.ts";

/** `sha256:` plus 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export function capabilityId(artifact: CapabilityArtifactT): string {
  return `cap:${sha256Hex(canonicalJson(artifact))}`;
}

export function programHash(program: ProgramT): string {
  return sha256Hex(canonicalJson(program));
}

export function verifierHash(verifier: VerifierT): string {
  return sha256Hex(canonicalJson(verifier));
}

export function counterexamplesHash(counterexamples: readonly CounterexampleT[]): string {
  return sha256Hex(canonicalJson(counterexamples));
}

export function dependenciesHash(dependencies: DependenciesT): string {
  return sha256Hex(canonicalJson(dependencies));
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
export function verifyRecord(rec: CapabilityRecordT): { ok: true } | Extract<GuardResultT, { status: "stale" }> {
  if (rec.id === capabilityId(rec.artifact)) return { ok: true };
  return staleResult("artifact_hash_mismatch", "record id does not match the canonical artifact hash");
}
