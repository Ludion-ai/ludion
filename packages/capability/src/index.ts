// Everything the schema-branch entry exports (all of ./schema.ts plus glob matchers), then the compiler API.
export * from "./schema.ts";
export { anyGlob, globMatch } from "./glob.ts";
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
  VERIFIER_MOUNT_DIR,
  FIXED_PROTECTED_GLOBS,
  VERIFIER_STORE_PREFIX,
  PinnedImage,
  imageDigest,
  effectiveProtectedPaths,
  globsMayOverlap,
  VerifierRuntime,
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
export { capabilityId, counterexamplesHash, dependenciesHash, fileDigest, programHash, sha256Hex, staleResult, verifierHash, verifyRecord } from "./hash.ts";
export { evaluateGuard, type GuardInput } from "./guard.ts";
export { checkReceiptReuse, runIfExecutable, validateReceipt, type ReuseCurrent, type ReuseResult } from "./receipt.ts";
export {
  buildProgramDockerArgs,
  createDockerRunner,
  executeProgram,
  PINNED_VERSION_SET,
  resolveSandboxUser,
  resolveWritableFiles,
  toDockerMountSource,
  validateWriteGlobs,
} from "./executor.ts";
export type {
  DockerRunOutcome,
  DockerRunRequest,
  DockerRunner,
  ExecuteProgramInput,
  ExecutionEvidence,
  PreRepairEvidence,
  ProgramDockerArgsOpts,
  ProgramExecution,
  RedFlag,
} from "./executor.ts";
