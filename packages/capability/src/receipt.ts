import type { CapabilityRecordT, GuardResultT, ReceiptT } from "./schema.ts";
import { CapabilityRecord, Receipt, EXECUTABLE, imageDigest } from "./schema.ts";
import { counterexamplesHash, programHash, staleResult, verifierHash, verifyRecord } from "./hash.ts";
import { nodeMajor } from "./node-version.ts";

function failureText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Receipt plus count checks that the schema does not express.
 * When a verifier is present, passed + failed + skipped + todo equals total,
 * passed does not exceed total, and required_passed is no longer than passed.
 */
const ReceiptChecked = Receipt.superRefine((r, ctx) => {
  if (r.outcome !== "executed") return;
  const counts = r.verifier.tests;
  if (counts.passed + counts.failed + counts.skipped + counts.todo !== counts.total) {
    ctx.addIssue({ code: "custom", message: "verifier tests passed + failed + skipped + todo must equal total" });
  }
  if (counts.passed > counts.total) {
    ctx.addIssue({ code: "custom", message: "verifier tests passed must not exceed total" });
  }
  if (r.verifier.required_passed.length > counts.passed) {
    ctx.addIssue({ code: "custom", message: "required_passed must not have more entries than passed" });
  }
});

export function validateReceipt(x: unknown) {
  return ReceiptChecked.safeParse(x);
}

export type ReuseCurrent = {
  source_tree_hash: string;
  lockfile_hash: string;
  node_version: string;
  /** Current dependency capability ids for this record, in artifact order.
   *  Omit to compare against an empty array. Any difference from artifact.dependencies.capabilities is dependency_changed.
   */
  dependency_ids?: readonly string[];
};

export type ReuseRejectionReason =
  | "invalid_receipt"
  | "invalid_record"
  | "not_executed"
  | "not_verified"
  | "required_tests_missing"
  | "image_mismatch";

export type ReuseResult =
  | { reusable: true }
  | Extract<GuardResultT, { status: "stale" }>
  | { reusable: false; reason: ReuseRejectionReason; detail: string };

function reject(reason: ReuseRejectionReason, detail: string): ReuseResult {
  return { reusable: false, reason, detail: detail.slice(0, 500) };
}

/**
 * Whether an existing receipt can still be reused.
 * Parses the receipt and the record first. A hashing or canonicalisation error is
 * invalid_receipt or invalid_record and does not throw. Then record integrity, program hash,
 * verifier hash, counterexamples hash, dependency snapshot, capability id, lockfile, and source tree.
 * An executed verified receipt must cover every required test, pin the same image digest,
 * and match the current node major. A node patch difference stays reusable.
 * A node major difference is stale/runtime_changed.
 */
export function checkReceiptReuse(receipt: unknown, record: unknown, current: ReuseCurrent): ReuseResult {
  let got: ReceiptT;
  try {
    const receiptParsed = ReceiptChecked.safeParse(receipt);
    if (!receiptParsed.success) {
      return reject("invalid_receipt", receiptParsed.error.issues[0]?.message ?? "receipt did not parse");
    }
    got = receiptParsed.data;
  } catch (err) {
    return reject("invalid_receipt", failureText(err));
  }

  let rec: CapabilityRecordT;
  try {
    const recordParsed = CapabilityRecord.safeParse(record);
    if (!recordParsed.success) {
      return reject("invalid_record", recordParsed.error.issues[0]?.message ?? "record did not parse");
    }
    rec = recordParsed.data;
  } catch (err) {
    return reject("invalid_record", failureText(err));
  }

  try {
    const integrity = verifyRecord(rec);
    if (!("ok" in integrity)) return integrity;
    if (got.program_hash !== programHash(rec.artifact.program)) {
      return staleResult("program_changed", "program hash differs from the receipt", "program");
    }
    if (got.verifier_hash !== verifierHash(rec.artifact.verifier)) {
      return staleResult("verifier_changed", "verifier hash differs from the receipt", "verifier");
    }
    if (got.counterexamples_hash !== counterexamplesHash(rec.counterexamples)) {
      return staleResult("counterexample_added", "counterexamples hash differs from the receipt", "counterexamples");
    }
  } catch (err) {
    return reject("invalid_record", failureText(err));
  }
  const dependencyIds = current.dependency_ids ?? [];
  if (!sameIds(dependencyIds, rec.artifact.dependencies.capabilities)) {
    return staleResult("dependency_changed", "dependency capability ids differ from the current snapshot", "dependencies");
  }
  if (got.capability_id !== rec.id) {
    return staleResult("artifact_hash_mismatch", "receipt capability_id does not match the record id");
  }
  if (got.recipient.lockfile_hash !== current.lockfile_hash) {
    return staleResult("lockfile_changed", "lockfile hash differs from the receipt", "lockfile");
  }
  if (got.recipient.source_tree_hash !== current.source_tree_hash) {
    return staleResult("source_changed", "source tree hash differs from the receipt", "source");
  }
  if (got.outcome !== "executed") {
    return reject("not_executed", `outcome is ${got.outcome}`);
  }
  if (got.verifier.status !== "verified") {
    return reject("not_verified", `verifier status is ${got.verifier.status}`);
  }
  const missing = rec.artifact.verifier.required_tests.filter((name) => !got.verifier.required_passed.includes(name));
  if (missing.length > 0) {
    return reject("required_tests_missing", `missing required tests: ${missing.join(", ")}`);
  }
  const image = rec.artifact.dependencies.image;
  if (got.runtime.image !== image || got.runtime.image_digest !== imageDigest(image)) {
    return reject("image_mismatch", "runtime image does not match the artifact image");
  }
  const pinned = nodeMajor(got.runtime.node_version);
  const now = nodeMajor(current.node_version);
  if (pinned === null || now === null || pinned !== now) {
    return staleResult("runtime_changed", `node major ${now ?? "unreadable"} does not match receipt major ${pinned ?? "unreadable"}`, "runtime");
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
