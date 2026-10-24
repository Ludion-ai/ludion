export {
  Sha256,
  CapabilityId,
  Contract,
  StructureCondition,
  PackageCondition,
  Guard,
  Program,
  Verifier,
  Dependencies,
  Lineage,
  InvalidationTrigger,
  CapabilityArtifact,
  Counterexample,
  ReceiptRef,
  CapabilityRecord,
  GuardResult,
  VerifierResult,
  Receipt,
  EXECUTABLE,
} from "./schema.ts";
export type {
  Capability,
  CapabilityArtifactT,
  CapabilityRecordT,
  ContractT,
  CounterexampleT,
  DependenciesT,
  GuardResultT,
  GuardT,
  LineageT,
  PackageConditionT,
  ProgramT,
  ReceiptRefT,
  ReceiptT,
  StaleReason,
  StructureConditionT,
  VerifierResultT,
  VerifierT,
} from "./schema.ts";
export { canonicalJson } from "./canonical-json.ts";
export { capabilityId, counterexamplesHash, dependenciesHash, programHash, sha256Hex, staleResult, verifierHash, verifyRecord } from "./hash.ts";
export { evaluateGuard, type GuardInput } from "./guard.ts";
export { checkReceiptReuse, runIfExecutable, validateReceipt, type ReuseCurrent } from "./receipt.ts";
