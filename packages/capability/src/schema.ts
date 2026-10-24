// Single source for capability types. JSON Schema is generated with z.toJSONSchema.
// superRefine invariants are not emitted into JSON Schema; zod is the validator.
import { z } from "zod";
import { globCoversDir, globMayOverlapDir, globsMayOverlap } from "./glob.ts";

export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** sha256 of the canonical JSON of a CapabilityArtifact. The id is not part of the artifact. */
export const CapabilityId = z.string().regex(/^cap:sha256:[0-9a-f]{64}$/);
const ExactSemver = z.string().regex(/^\d+\.\d+\.\d+$/);
const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const UtcTime = z.iso.datetime({ offset: false });
const Slug = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/);
/** Work-copy relative path. Rejects absolute paths, drive letters, and `..`. */
const RelPath = z.string().min(1).max(260).refine(
  (p) => !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes(".."),
  "work-copy relative path",
);
const Glob = z.string().min(1).max(200);
const Files = z.record(RelPath, z.string());

export const Contract = z.strictObject({
  id: Slug,
  intent: z.string().min(10).max(400),
  pre: z.array(z.string().max(300)).min(1),
  post: z.array(z.strictObject({ statement: z.string().max(300), verified_by: z.array(z.string()).min(1) })).min(1),
  excludes: z.array(z.string().max(300)).default([]),
});

const ImportTarget = z.strictObject({
  module: z.string(),
  export: z.string(),
  member: z.array(z.string()).default([]),
});

export const StructureCondition = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("call"),
    target: ImportTarget,
    files: z.array(Glob).min(1),
    /** required: at least one resolved call. absent_in_scope: a resolved call in the same brace block as a required call is already_fixed. */
    presence: z.enum(["required", "absent_in_scope"]),
    /** Only import-resolved calls count. A same-named local is not a match. An unresolved call of the target shape is unknown. */
    binding: z.literal("import_resolved"),
  }),
  z.strictObject({
    kind: z.literal("config"),
    file: z.array(Glob).min(1),
    key: z.string(),
    /** Numeric literals are integers because canonical JSON rejects other numbers. */
    inapplicable_if: z.union([z.boolean(), z.string(), z.number().int()]),
  }),
]);

export const PackageCondition = z.strictObject({
  ecosystem: z.literal("npm"),
  name: z.string(),
  applicable_versions: z.array(ExactSemver).min(1),
  inapplicable_versions: z.array(ExactSemver).default([]),
});

export const Guard = z.strictObject({
  contract_id: Slug,
  structure: z.array(StructureCondition).min(1),
  packages: z.array(PackageCondition).min(1),
  runtime: z.strictObject({ node_major: z.array(z.string().regex(/^\d+$/)).min(1) }),
}).superRefine((g, ctx) => {
  const s = JSON.stringify(g);
  if (/sha256:|\b[0-9a-f]{40,}\b/.test(s)) ctx.addIssue({ code: "custom", message: "guard must not contain content hashes" });
  if (/(^|")([A-Za-z]:[\\/]|\/(home|Users|w)\/)/.test(s)) ctx.addIssue({ code: "custom", message: "guard must not contain absolute paths" });
  for (const p of g.packages) {
    if (p.applicable_versions.some((v) => p.inapplicable_versions.includes(v))) {
      ctx.addIssue({ code: "custom", message: `${p.name}: version listed as both applicable and inapplicable` });
    }
  }
});

export const Program = z.strictObject({
  kind: z.literal("codemod.ts-ast"),
  entry: RelPath,
  files: Files,
  effects: z.strictObject({
    writes: z.array(Glob).min(1),
    network: z.literal(false),
    env: z.array(z.string()).max(0),
    spawn: z.literal(false),
  }),
  timeout_ms: z.number().int().positive().max(120_000),
});

export const Verifier = z.strictObject({
  kind: z.literal("vitest-run"),
  files: Files,
  mount_at: RelPath,
  argv: z.array(z.string()).min(1),
  required_tests: z.array(z.string()).min(1),
  run_recipient_tests: z.boolean(),
  protected_paths: z.array(Glob).min(1),
  allow_skip: z.literal(false),
  timeout_ms: z.number().int().positive().max(300_000),
});

export const Dependencies = z.strictObject({
  capabilities: z.array(CapabilityId).default([]),
  image: z.string(),
});

export const Lineage = z.strictObject({
  derived_from: z.array(z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("lesson"), id: Ulid }),
    z.strictObject({ kind: z.literal("trace"), hash: Sha256, synthetic: z.boolean() }),
    z.strictObject({ kind: z.literal("capability"), id: CapabilityId }),
  ])).min(1),
  compiler: z.strictObject({ name: z.string(), version: z.string(), model: z.string().nullable() }),
  created_at: UtcTime,
});

export const InvalidationTrigger = z.enum([
  "program_changed",
  "verifier_changed",
  "dependency_changed",
  "counterexample_added",
  "lockfile_changed",
  "source_changed",
  "runtime_changed",
]);
const REQUIRED_TRIGGERS = ["program_changed", "verifier_changed", "dependency_changed", "counterexample_added"] as const;

/** Hashed body. Lineage and counterexamples are outside this object so they do not change the id. */
export const CapabilityArtifact = z.strictObject({
  format: z.literal("capability/1"),
  contract: Contract,
  guard: Guard,
  program: Program,
  verifier: Verifier,
  dependencies: Dependencies,
  invalidates_on: z.array(InvalidationTrigger).min(1),
}).superRefine((a, ctx) => {
  for (const t of REQUIRED_TRIGGERS) {
    if (!a.invalidates_on.includes(t)) ctx.addIssue({ code: "custom", message: `invalidates_on must include ${t}` });
  }
  if (a.guard.contract_id !== a.contract.id) ctx.addIssue({ code: "custom", message: "guard.contract_id != contract.id" });
  for (const p of a.contract.post) {
    for (const t of p.verified_by) {
      if (!a.verifier.required_tests.includes(t)) {
        ctx.addIssue({ code: "custom", message: `post condition test "${t}" is not a required verifier test` });
      }
    }
  }
  // The verifier tree is mounted fresh AFTER program execution (P2 runner). P1 still rejects a write
  // glob that may intersect a protected glob or the mount directory, using literal-prefix overlap.
  // An empty prefix (for example `**/*.test.ts`) overlaps everything.
  for (const w of a.program.effects.writes) {
    for (const p of a.verifier.protected_paths) {
      if (globsMayOverlap(w, p)) {
        ctx.addIssue({ code: "custom", message: `program.effects.writes glob "${w}" overlaps verifier.protected_paths glob "${p}"` });
      }
    }
    if (globMayOverlapDir(w, a.verifier.mount_at)) {
      ctx.addIssue({ code: "custom", message: `program.effects.writes glob "${w}" overlaps verifier mount_at "${a.verifier.mount_at}"` });
    }
  }
  if (!a.verifier.protected_paths.some((p) => globCoversDir(p, a.verifier.mount_at))) {
    ctx.addIssue({ code: "custom", message: "protected_paths must cover verifier mount_at" });
  }
});

export const Counterexample = z.strictObject({
  id: Ulid,
  kind: z.enum(["near_miss", "false_apply", "verifier_gap"]),
  description: z.string().max(400),
  fixture: Files,
  expected: z.enum(["inapplicable", "unknown", "verifier_rejects"]),
  found_by_receipt: Ulid.nullable(),
  found_at: UtcTime,
});

export const ReceiptRef = z.strictObject({ receipt_id: Ulid, hash: Sha256, recipient: z.string() });

/** Record around an immutable artifact. Lineage, counterexamples, and receipt refs are not part of the id. */
export const CapabilityRecord = z.strictObject({
  id: CapabilityId,
  artifact: CapabilityArtifact,
  lineage: Lineage,
  counterexamples: z.array(Counterexample).default([]),
  receipts: z.array(ReceiptRef).default([]),
});

const Match = z.strictObject({ file: RelPath, line: z.number().int().positive(), via: z.enum(["import", "alias"]) });
const Check = z.strictObject({ condition: z.string(), ok: z.boolean().nullable(), note: z.string().max(300).optional() });
const base = { detail: z.string().max(500), checks: z.array(Check) };

export const GuardResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("applicable"), reason: z.literal("all_conditions_met"), matches: z.array(Match).min(1), ...base }),
  z.strictObject({
    status: z.literal("inapplicable"),
    reason: z.enum([
      "contract_mismatch",
      "package_absent",
      "version_verified_inapplicable",
      "runtime_mismatch",
      "target_absent",
      "already_fixed",
      "config_excludes",
      "known_counterexample",
    ]),
    ...base,
  }),
  z.strictObject({
    status: z.literal("unknown"),
    reason: z.enum([
      "intent_missing",
      "lockfile_unreadable",
      "version_unverified",
      "parse_failed",
      "binding_unresolved",
      "config_not_static",
      "environment_unavailable",
    ]),
    ...base,
  }),
  // Deviation from the draft enum: lockfile_changed and source_changed are receipt-reuse reasons
  // (they were already invalidation triggers). runtime_changed is the node-major reuse failure;
  // a patch difference stays reusable and does not use this reason.
  z.strictObject({
    status: z.literal("stale"),
    reason: z.enum([
      "artifact_hash_mismatch",
      "program_changed",
      "verifier_changed",
      "dependency_changed",
      "counterexample_added",
      "lockfile_changed",
      "source_changed",
      "runtime_changed",
    ]),
    ...base,
  }),
]);

export const VerifierResult = z.strictObject({
  status: z.enum(["verified", "failed", "skipped", "timeout", "start_failed", "tampered", "no_op"]),
  exit_code: z.number().int().nullable(),
  tests: z.strictObject({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    todo: z.number().int().nonnegative(),
  }),
  required_passed: z.array(z.string()),
  protected_paths_modified: z.array(RelPath),
}).superRefine((v, ctx) => {
  if (v.status === "verified" && (v.exit_code !== 0 || v.tests.failed + v.tests.skipped + v.tests.todo > 0 || v.tests.passed === 0 || v.protected_paths_modified.length > 0)) {
    ctx.addIssue({ code: "custom", message: "verified requires exit 0, no failed/skipped/todo, passed > 0, no protected-path change" });
  }
});

const VerifierRuntime = z.strictObject({
  vitest_version: ExactSemver,
  vitest_path: RelPath,
});

export const Receipt = z.strictObject({
  format: z.literal("receipt/1"),
  id: Ulid,
  capability_id: CapabilityId,
  recipient: z.strictObject({ label: z.string().max(120), source_tree_hash: Sha256, lockfile_hash: Sha256 }),
  program_hash: Sha256,
  verifier_hash: Sha256,
  counterexamples_hash: Sha256,
  resolved_versions: z.record(z.string(), ExactSemver),
  runtime: z.strictObject({
    node_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
    image: z.string(),
    image_digest: Sha256,
    platform: z.string(),
    network: z.literal("none"),
  }).nullable(),
  guard: GuardResult,
  outcome: z.enum(["executed", "not_executed", "environment_unavailable"]),
  verifier: VerifierResult.nullable(),
  /** Vitest binary the verifier actually ran. Required when outcome is executed. P2 still has to decide how to pin a recipient's node_modules. */
  verifier_runtime: VerifierRuntime.nullable(),
  diff: z.strictObject({ ref: RelPath, hash: Sha256, files_changed: z.number().int().nonnegative() }).nullable(),
  durations_ms: z.strictObject({
    guard: z.number().nonnegative(),
    install: z.number().nonnegative().nullable(),
    program: z.number().nonnegative().nullable(),
    verifier: z.number().nonnegative().nullable(),
    total: z.number().nonnegative(),
  }),
  model_calls: z.strictObject({ count: z.number().int().nonnegative(), span: z.literal("guard_to_verifier") }),
  started_at: UtcTime,
  finished_at: UtcTime,
}).superRefine((r, ctx) => {
  const ran = r.outcome === "executed";
  if (r.guard.status !== "applicable" && (ran || r.verifier || r.diff)) {
    ctx.addIssue({ code: "custom", message: `guard ${r.guard.status}: must not execute` });
  }
  if (ran && (!r.runtime || !r.verifier || !r.verifier_runtime)) {
    ctx.addIssue({ code: "custom", message: "executed run needs runtime, verifier result, and verifier provenance" });
  }
  if (r.verifier?.status === "verified" && !(r.diff && r.diff.files_changed > 0)) {
    ctx.addIssue({ code: "custom", message: "verified with empty diff is no_op, not a repair" });
  }
});

export type ContractT = z.infer<typeof Contract>;
export type StructureConditionT = z.infer<typeof StructureCondition>;
export type PackageConditionT = z.infer<typeof PackageCondition>;
export type GuardT = z.infer<typeof Guard>;
export type ProgramT = z.infer<typeof Program>;
export type VerifierT = z.infer<typeof Verifier>;
export type DependenciesT = z.infer<typeof Dependencies>;
export type LineageT = z.infer<typeof Lineage>;
export type CapabilityArtifactT = z.infer<typeof CapabilityArtifact>;
export type CounterexampleT = z.infer<typeof Counterexample>;
export type ReceiptRefT = z.infer<typeof ReceiptRef>;
export type CapabilityRecordT = z.infer<typeof CapabilityRecord>;
export type Capability = CapabilityRecordT;
export type GuardResultT = z.infer<typeof GuardResult>;
export type VerifierResultT = z.infer<typeof VerifierResult>;
export type ReceiptT = z.infer<typeof Receipt>;
export type StaleReason = Extract<GuardResultT, { status: "stale" }>["reason"];

export const EXECUTABLE = (r: GuardResultT) => r.status === "applicable";
