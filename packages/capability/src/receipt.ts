import type { CapabilityRecordT, GuardResultT, ReceiptT } from "./schema.ts";
import { Receipt, EXECUTABLE } from "./schema.ts";
import { counterexamplesHash, programHash, staleResult, verifierHash, verifyRecord } from "./hash.ts";
import { nodeMajor } from "./node-version.ts";

export function validateReceipt(x: unknown) {
  return Receipt.safeParse(x);
}

export type ReuseCurrent = {
  source_tree_hash: string;
  lockfile_hash: string;
  node_version: string;
  /** Current dependency capability ids for this record, in artifact order.
   *  Omit to skip the check. Any difference from artifact.dependencies.capabilities is dependency_changed.
   */
  dependency_ids?: readonly string[];
};

/**
 * Whether an existing receipt can still be reused.
 * Order: corrupt record, program hash, verifier hash, counterexamples hash, dependency snapshot,
 * capability id, lockfile, source tree, node major.
 * A node patch difference stays reusable. A node major difference is stale/runtime_changed.
 * When the receipt did not record a runtime, the major is not compared.
 */
export function checkReceiptReuse(
  receipt: ReceiptT,
  record: CapabilityRecordT,
  current: ReuseCurrent,
): { reusable: true } | Extract<GuardResultT, { status: "stale" }> {
  const integrity = verifyRecord(record);
  if (!("ok" in integrity)) return integrity;
  if (receipt.program_hash !== programHash(record.artifact.program)) {
    return staleResult("program_changed", "program hash differs from the receipt", "program");
  }
  if (receipt.verifier_hash !== verifierHash(record.artifact.verifier)) {
    return staleResult("verifier_changed", "verifier hash differs from the receipt", "verifier");
  }
  if (receipt.counterexamples_hash !== counterexamplesHash(record.counterexamples)) {
    return staleResult("counterexample_added", "counterexamples hash differs from the receipt", "counterexamples");
  }
  if (current.dependency_ids !== undefined && !sameIds(current.dependency_ids, record.artifact.dependencies.capabilities)) {
    return staleResult("dependency_changed", "dependency capability ids differ from the current snapshot", "dependencies");
  }
  if (receipt.capability_id !== record.id) {
    return staleResult("artifact_hash_mismatch", "receipt capability_id does not match the record id");
  }
  if (receipt.recipient.lockfile_hash !== current.lockfile_hash) {
    return staleResult("lockfile_changed", "lockfile hash differs from the receipt", "lockfile");
  }
  if (receipt.recipient.source_tree_hash !== current.source_tree_hash) {
    return staleResult("source_changed", "source tree hash differs from the receipt", "source");
  }
  if (receipt.runtime) {
    const pinned = nodeMajor(receipt.runtime.node_version);
    const now = nodeMajor(current.node_version);
    if (pinned === null || now === null || pinned !== now) {
      return staleResult("runtime_changed", `node major ${now ?? "unreadable"} does not match receipt major ${pinned ?? "unreadable"}`, "runtime");
    }
  }
  return { reusable: true };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Calls `runner` only when the guard result is applicable. */
export function runIfExecutable<T>(result: GuardResultT, runner: () => T): T | undefined {
  if (!EXECUTABLE(result)) return undefined;
  return runner();
}
