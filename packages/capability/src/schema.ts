// Single source for capability types. JSON Schema is generated with z.toJSONSchema.
// superRefine invariants are not emitted into JSON Schema; zod is the validator.
import { z } from "zod";

export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** sha256 of the canonical JSON of a CapabilityArtifact. The id is not part of the artifact. */
export const CapabilityId = z.string().regex(/^cap:sha256:[0-9a-f]{64}$/);
const ExactSemver = z.string().regex(/^\d+\.\d+\.\d+$/);
const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const UtcTime = z.iso.datetime({ offset: false });
const Slug = z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,63}$/);

const MAX_EXPANSIONS = 64;
const GLOB_CHARSET = /^[A-Za-z0-9._\-/*?{},@+]+$/;

/** Work-copy relative path: no absolute, drive, stream, dot segment, encoding trick, or non-NFC text. */
function isSafeRelPath(p: string): boolean {
  if (p.length === 0 || !p.isWellFormed() || p !== p.normalize("NFC")) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\\") || p.includes("%") || p.includes(":")) return false;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === "..") return false;
  }
  return true;
}

function countStars(p: string): number {
  let n = 0;
  for (let i = 0; i < p.length; i++) if (p[i] === "*") n++;
  return n;
}

/** Balanced braces, no nesting, at most two groups. */
function bracesOk(p: string): boolean {
  let depth = 0;
  let groups = 0;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "{") {
      if (depth !== 0) return false;
      depth = 1;
      groups++;
      if (groups > 2) return false;
    } else if (c === "}") {
      if (depth === 0) return false;
      depth = 0;
    }
  }
  return depth === 0;
}

function splitTopCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Expand every `{a,b}` group. Null when unbalanced, nested, or the cap would be exceeded. */
function expandBraces(pattern: string): string[] | null {
  const out: string[] = [];
  const walk = (current: string): boolean => {
    const start = current.indexOf("{");
    if (start < 0) {
      if (out.length >= MAX_EXPANSIONS) return false;
      out.push(current);
      return true;
    }
    let depth = 0;
    let end = -1;
    for (let i = start; i < current.length; i++) {
      const c = current[i];
      if (c === "{") {
        depth++;
        if (depth > 1) return false;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return false;
    const before = current.slice(0, start);
    const after = current.slice(end + 1);
    for (const alt of splitTopCommas(current.slice(start + 1, end))) {
      if (!walk(before + alt + after)) return false;
    }
    return true;
  };
  return walk(pattern) ? out : null;
}

function isGlob(p: string): boolean {
  if (!isSafeRelPath(p) || p.length > 200) return false;
  if (!GLOB_CHARSET.test(p)) return false;
  if (countStars(p) > 8) return false;
  if (!bracesOk(p)) return false;
  const expanded = expandBraces(p);
  if (expanded === null) return false;
  for (const one of expanded) {
    if (!isSafeRelPath(one)) return false;
    // Windows drops a trailing dot: `tools/verify./x` names `tools/verify/x`.
    if (one.split("/").some((s) => s.endsWith("."))) return false;
  }
  return true;
}

const RelPath = z.string().min(1).max(260).refine(isSafeRelPath, "work-copy relative path");
const Glob = z.string().min(1).max(200).refine(isGlob, "glob");
const WellFormed = z.string().refine((s) => s.isWellFormed(), "well-formed UTF-16");
const Files = z.record(RelPath, WellFormed).superRefine((files, ctx) => {
  const seen = new Set<string>();
  for (const key of Object.keys(files)) {
    const folded = key.toLowerCase();
    if (seen.has(folded)) ctx.addIssue({ code: "custom", message: `duplicate file path ignoring case: ${key}` });
    seen.add(folded);
  }
});

/** Image reference pinned by digest. Name, then `@sha256:` and 64 lowercase hex digits. */
export const PinnedImage = z.string().max(300).regex(/^[a-z0-9][a-z0-9._\/:-]*@sha256:[0-9a-f]{64}$/);

/** `sha256:<hex>` suffix of a PinnedImage reference. */
export function imageDigest(ref: string): string {
  const at = ref.lastIndexOf("@");
  return at < 0 ? "" : ref.slice(at + 1);
}

export const VERIFIER_MOUNT_DIR = ".ludion-verify" as const;

/** Writes may never touch these, whatever the producer lists. */
export const FIXED_PROTECTED_GLOBS = [
  ".ludion-verify/**",
  "tools/verify/**",
  ".github/**",
  ".git/**",
  "**/.git/**",
  "**/.git",
  "**/.gitmodules",
  "**/.husky/**",
  "node_modules/**",
  "**/node_modules/**",
  "**/package.json",
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/vitest.config.{ts,mts,cts,js,mjs,cjs}",
  "**/vite.config.{ts,mts,cts,js,mjs,cjs}",
  "**/vitest.workspace.{ts,mts,cts,js,mjs,cjs,json}",
  "**/vitest.setup.{ts,mts,cts,js,mjs,cjs}",
  "**/vitest-setup.{ts,mts,cts,js,mjs,cjs}",
  "**/setupTests.{ts,mts,cts,js,mjs,cjs}",
  "**/test-setup.{ts,mts,cts,js,mjs,cjs}",
  "**/tsconfig*.json",
  "**/.npmrc",
  // Yarn v1 .yarnrc and Berry .yarnrc.yml. Not "**/.yarnrc*": with conservative overlap that glob
  // would collide with every "*.test.ts" write (e.g. ".yarnrc.test.ts").
  "**/.yarnrc",
  "**/.yarnrc.yml",
  "**/.yarnrc.yaml",
  "**/.pnpmfile.cjs",
] as const;

/** De-duplicated union of the fixed denylist and producer extras. */
export function effectiveProtectedPaths(v: { protected_paths: readonly string[] }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of FIXED_PROTECTED_GLOBS) {
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  for (const g of v.protected_paths) {
    if (!seen.has(g)) {
      seen.add(g);
      out.push(g);
    }
  }
  return out;
}

/**
 * Whether two sequences may name a common value.
 * `star` matches zero or more atoms (`**` for segments, `*` for characters).
 * State pairs stay polynomial via a visited set.
 */
function sequencesMayOverlap(
  a: string | readonly string[],
  b: string | readonly string[],
  star: string,
  atomsIntersect: (x: string, y: string) => boolean,
): boolean {
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [[0, 0]];
  seen.add("0:0");
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head++;
    if (cur === undefined) continue;
    const i = cur[0];
    const j = cur[1];
    if (i === a.length && j === b.length) return true;
    const ai = i < a.length ? a[i] : undefined;
    const bj = j < b.length ? b[j] : undefined;
    if (ai === star) {
      enqueue(i + 1, j);
      if (j < b.length) enqueue(i, j + 1);
    }
    if (bj === star) {
      enqueue(i, j + 1);
      if (i < a.length) enqueue(i + 1, j);
    }
    if (ai !== undefined && bj !== undefined && ai !== star && bj !== star && atomsIntersect(ai, bj)) {
      enqueue(i + 1, j + 1);
    }
  }
  return false;

  function enqueue(ni: number, nj: number) {
    const key = `${ni}:${nj}`;
    if (seen.has(key)) return;
    seen.add(key);
    queue.push([ni, nj]);
  }
}

function charsMayOverlap(a: string, b: string): boolean {
  return sequencesMayOverlap(a, b, "*", (x, y) => x === "?" || y === "?" || x === y);
}

function segmentsMayOverlap(a: readonly string[], b: readonly string[]): boolean {
  return sequencesMayOverlap(a, b, "**", charsMayOverlap);
}

/** True when some path may match both globs. Case-insensitive. Brace expansion is capped. */
export function globsMayOverlap(a: string, b: string): boolean {
  const left = expandBraces(a.toLowerCase());
  const right = expandBraces(b.toLowerCase());
  if (left === null || right === null) return true;
  for (const pa of left) {
    for (const pb of right) {
      if (segmentsMayOverlap(pa.split("/"), pb.split("/"))) return true;
    }
  }
  return false;
}

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

const ArgvRest = z.string().max(200);
/** argv is owned by the P2 runner; the runner rejects flags such as --config, --root, and --passWithNoTests. The schema only pins argv[0]. */
const VerifierArgv = z.tuple([z.literal("vitest")], ArgvRest).superRefine((argv, ctx) => {
  if (argv.length > 16) ctx.addIssue({ code: "custom", message: "argv has at most 16 items" });
});

export const Verifier = z.strictObject({
  kind: z.literal("vitest-run"),
  /** The verifier runner is tools/verify at main_commit. tools_verify_hash is the sha256 of that tree. */
  source: z.strictObject({
    repo: z.literal("Ludion-ai/ludion"),
    main_commit: z.string().regex(/^[0-9a-f]{40}$/),
    tools_verify_hash: Sha256,
  }),
  files: Files,
  mount_at: z.literal(VERIFIER_MOUNT_DIR),
  argv: VerifierArgv,
  required_tests: z.array(z.string()).min(1),
  run_recipient_tests: z.boolean(),
  /** Producer extras. The fixed denylist always applies on top of this list. */
  protected_paths: z.array(Glob).default([]),
  allow_skip: z.literal(false),
  timeout_ms: z.number().int().positive().max(300_000),
});

export const Dependencies = z.strictObject({
  capabilities: z.array(CapabilityId).default([]),
  image: PinnedImage,
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
  // Writes may not intersect the fixed denylist or producer protected_paths.
  // `**` reaches dot-directories, so `src/**/*.test.ts` overlaps `**/node_modules/**`.
  for (const w of a.program.effects.writes) {
    for (const p of effectiveProtectedPaths(a.verifier)) {
      if (globsMayOverlap(w, p)) {
        ctx.addIssue({ code: "custom", message: `program.effects.writes glob "${w}" overlaps protected glob "${p}"` });
      }
    }
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
  if (v.status !== "verified") return;
  if (v.exit_code !== 0 || v.tests.failed + v.tests.skipped + v.tests.todo > 0 || v.tests.passed === 0 || v.protected_paths_modified.length > 0) {
    ctx.addIssue({ code: "custom", message: "verified requires exit 0, no failed/skipped/todo, passed > 0, no protected-path change" });
  }
  if (v.required_passed.length === 0) {
    ctx.addIssue({ code: "custom", message: "verified requires required_passed to be non-empty" });
  }
  const seen = new Set<string>();
  for (const name of v.required_passed) {
    if (seen.has(name)) ctx.addIssue({ code: "custom", message: `duplicate required_passed test "${name}"` });
    seen.add(name);
  }
});

/** Read-only mount of the verifier deps inside the container (P2 runner), installed from main's lockfile at verifier.source.main_commit. */
export const VERIFIER_STORE_PREFIX = "/verifier/" as const;

/** SemVer 2.0 including prerelease and build metadata. Linear-time regex: separators are outside each class. */
const FullSemver = z.string().max(128).regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
);

function isVerifierRealpath(p: string): boolean {
  if (!p.startsWith(VERIFIER_STORE_PREFIX)) return false;
  if (!p.isWellFormed()) return false;
  if (p.includes("\\") || p.includes("%") || p.includes("//")) return false;
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return false;
  }
  for (const s of p.split("/")) {
    if (s === "." || s === "..") return false;
  }
  return true;
}

/** Vitest is loaded from the verifier store, never from the recipient's node_modules. */
export const VerifierRuntime = z.strictObject({
  vitest_location: z.literal("verifier_store"),
  vitest_realpath: z.string().max(400).refine(isVerifierRealpath, "verifier-store realpath"),
  vitest_version: FullSemver,
  vitest_integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/),
  /** 64 lowercase hex, no `sha256:` prefix. */
  lockfile_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

const Runtime = z.strictObject({
  node_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  image: PinnedImage,
  image_digest: Sha256,
  platform: z.string(),
  network: z.literal("none"),
});

const Diff = z.strictObject({
  ref: RelPath,
  hash: Sha256,
  files_changed: z.number().int().nonnegative(),
});

const receiptBase = {
  format: z.literal("receipt/1"),
  id: Ulid,
  capability_id: CapabilityId,
  recipient: z.strictObject({ label: z.string().max(120), source_tree_hash: Sha256, lockfile_hash: Sha256 }),
  program_hash: Sha256,
  verifier_hash: Sha256,
  counterexamples_hash: Sha256,
  resolved_versions: z.record(z.string(), ExactSemver),
  guard: GuardResult,
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
};

const ExecutedReceipt = z.strictObject({
  ...receiptBase,
  outcome: z.literal("executed"),
  runtime: Runtime,
  verifier: VerifierResult,
  /** Vitest binary the verifier actually ran. Loaded from the verifier store, never from the recipient's node_modules. */
  verifier_runtime: VerifierRuntime,
  diff: Diff.nullable(),
});

const NotExecutedReceipt = z.strictObject({
  ...receiptBase,
  outcome: z.literal("not_executed"),
  runtime: z.null(),
  verifier: z.null(),
  verifier_runtime: z.null(),
  diff: z.null(),
});

const EnvironmentUnavailableReceipt = z.strictObject({
  ...receiptBase,
  outcome: z.literal("environment_unavailable"),
  runtime: z.null(),
  verifier: z.null(),
  verifier_runtime: z.null(),
  diff: z.null(),
});

export const Receipt = z.discriminatedUnion("outcome", [
  ExecutedReceipt,
  NotExecutedReceipt,
  EnvironmentUnavailableReceipt,
]).superRefine((r, ctx) => {
  if (r.outcome !== "executed") return;
  if (r.guard.status !== "applicable") {
    ctx.addIssue({ code: "custom", message: `guard ${r.guard.status}: must not execute` });
  }
  if (r.verifier.status === "verified" && !(r.diff && r.diff.files_changed > 0)) {
    ctx.addIssue({ code: "custom", message: "verified with empty diff is no_op, not a repair" });
  }
  if (imageDigest(r.runtime.image) !== r.runtime.image_digest) {
    ctx.addIssue({ code: "custom", message: "runtime.image digest must equal runtime.image_digest" });
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
