import {
  CapabilityArtifact,
  CapabilityRecord,
  Counterexample,
  Receipt,
  capabilityId,
  counterexamplesHash,
  programHash,
  sha256Hex,
  verifierHash,
  type CapabilityArtifactT,
  type CapabilityRecordT,
  type CounterexampleT,
  type GuardResultT,
  type LineageT,
  type ReceiptT,
} from "../src/index.ts";

export const CONTRACT_ID = "mock_cleanup.clear_history";

export const APPLICABLE_VERSIONS: Record<string, string> = { vitest: "4.0.0", vite: "7.1.11" };

export const applicableTest = [
  'import { vi } from "vitest";',
  "afterEach(() => {",
  "  vi.restoreAllMocks();",
  "});",
  "",
].join("\n");

export const aliasTest = [
  'import { vi as v } from "vitest";',
  "afterEach(() => {",
  "  v.restoreAllMocks();",
  "});",
  "",
].join("\n");

export const localFunctionTest = [
  "function restoreAllMocks() {",
  "  return 0;",
  "}",
  "afterEach(() => {",
  "  restoreAllMocks();",
  "});",
  "",
].join("\n");

export const globalsTest = [
  "afterEach(() => {",
  "  vi.restoreAllMocks();",
  "});",
  "",
].join("\n");

export const alreadyFixedTest = [
  'import { vi } from "vitest";',
  "afterEach(() => {",
  "  vi.clearAllMocks();",
  "  vi.restoreAllMocks();",
  "});",
  "",
].join("\n");

export const clearMocksConfig = [
  'import { defineConfig } from "vitest/config";',
  "export default defineConfig({",
  "  test: { clearMocks: true },",
  "});",
  "",
].join("\n");

export const functionConfig = [
  'import { defineConfig } from "vitest/config";',
  "export default defineConfig(() => ({",
  "  test: { clearMocks: false },",
  "}));",
  "",
].join("\n");

export function applicableFiles(): Record<string, string> {
  return { "src/history.test.ts": applicableTest };
}

export function exampleLineage(createdAt = "2026-10-25T00:00:00Z"): LineageT {
  return {
    derived_from: [{ kind: "lesson", id: "01M4T6BQ9DJH2BCV6Q28GH4HJ1" }],
    compiler: { name: "manual-p1-fixture", version: "0", model: null },
    created_at: createdAt,
  };
}

export function exampleArtifactInput(): CapabilityArtifactT {
  return {
    format: "capability/1",
    contract: {
      id: CONTRACT_ID,
      intent: "Vitest 4で afterEach の vi.restoreAllMocks() に頼っていた vi.fn() 呼び出し履歴のcleanupを復元する",
      pre: ["テストが cleanup 後の mock.calls が空であることを前提にしている"],
      post: [
        { statement: "cleanup後、vi.fn() の mock.calls が空", verified_by: ["history-cleared"] },
        { statement: "vi.spyOn の元実装は従来どおり復元される", verified_by: ["spy-restored"] },
        { statement: "vi.fn(impl) の実装は消えない（resetではない）", verified_by: ["impl-kept"] },
      ],
      excludes: ["mock実装のreset（mockReset/resetAllMocks）", "configの clearMocks 全体有効化"],
    },
    guard: {
      contract_id: CONTRACT_ID,
      structure: [
        {
          kind: "call",
          target: { module: "vitest", export: "vi", member: ["restoreAllMocks"] },
          files: ["**/*.{test,spec}.{ts,mts,js,mjs}"],
          presence: "required",
          binding: "import_resolved",
        },
        {
          kind: "call",
          target: { module: "vitest", export: "vi", member: ["clearAllMocks"] },
          files: ["**/*.{test,spec}.{ts,mts,js,mjs}"],
          presence: "absent_in_scope",
          binding: "import_resolved",
        },
        { kind: "config", file: ["vitest.config.*", "vite.config.*"], key: "test.clearMocks", inapplicable_if: true },
      ],
      packages: [
        { ecosystem: "npm", name: "vitest", applicable_versions: ["4.0.0"], inapplicable_versions: ["3.2.4"] },
        { ecosystem: "npm", name: "vite", applicable_versions: ["7.1.11"], inapplicable_versions: [] },
      ],
      runtime: { node_major: ["24"] },
    },
    program: {
      kind: "codemod.ts-ast",
      entry: "insert-clear.ts",
      files: { "insert-clear.ts": "/* Insert vi.clearAllMocks() immediately before a resolved vi.restoreAllMocks() call. */\nexport {}\n" },
      effects: { writes: ["src/**/*.test.ts", "test/**/*.test.ts"], network: false, env: [], spawn: false },
      timeout_ms: 60_000,
    },
    verifier: {
      kind: "vitest-run",
      files: { "contract.test.mjs": "/* history-cleared / spy-restored / impl-kept */\n" },
      mount_at: ".ludion-verify",
      argv: ["node", "node_modules/vitest/vitest.mjs", "run"],
      required_tests: ["history-cleared", "spy-restored", "impl-kept"],
      run_recipient_tests: true,
      protected_paths: [".ludion-verify/**"],
      allow_skip: false,
      timeout_ms: 120_000,
    },
    dependencies: { capabilities: [], image: "node:24-slim" },
    invalidates_on: ["program_changed", "verifier_changed", "dependency_changed", "counterexample_added", "lockfile_changed", "source_changed"],
  };
}

export function exampleArtifact(): CapabilityArtifactT {
  return CapabilityArtifact.parse(exampleArtifactInput());
}

export function reseal(artifact: CapabilityArtifactT, lineage: LineageT = exampleLineage(), counterexamples: CounterexampleT[] = []): CapabilityRecordT {
  const parsed = CapabilityArtifact.parse(artifact);
  return CapabilityRecord.parse({
    id: capabilityId(parsed),
    artifact: parsed,
    lineage,
    counterexamples,
    receipts: [],
  });
}

export function exampleRecord(): CapabilityRecordT {
  return reseal(exampleArtifact());
}

function counterexample(input: {
  id: string;
  kind: CounterexampleT["kind"];
  description: string;
  fixture: Record<string, string>;
  expected: CounterexampleT["expected"];
}): CounterexampleT {
  return Counterexample.parse({
    ...input,
    found_by_receipt: null,
    found_at: "2026-10-25T00:00:00Z",
  });
}

export function exampleCounterexamples(): CounterexampleT[] {
  return [
    counterexample({
      id: "01M4T6BQ9DJH2BCV6Q28GH4HK1",
      kind: "near_miss",
      description: "A local function named restoreAllMocks is not the vitest call.",
      fixture: { "src/local.test.ts": localFunctionTest },
      expected: "inapplicable",
    }),
    counterexample({
      id: "01M4T6BQ9DJH2BCV6Q28GH4HK2",
      kind: "near_miss",
      description: "vi.restoreAllMocks with no vitest import cannot be bound.",
      fixture: { "src/global.test.ts": globalsTest },
      expected: "unknown",
    }),
    counterexample({
      id: "01M4T6BQ9DJH2BCV6Q28GH4HK3",
      kind: "false_apply",
      description: "clearAllMocks is already in the same block as restoreAllMocks.",
      fixture: { "src/fixed.test.ts": alreadyFixedTest },
      expected: "inapplicable",
    }),
    counterexample({
      id: "01M4T6BQ9DJH2BCV6Q28GH4HK4",
      kind: "near_miss",
      description: "test.clearMocks is already true.",
      fixture: { "src/history.test.ts": applicableTest, "vitest.config.ts": clearMocksConfig },
      expected: "inapplicable",
    }),
    counterexample({
      id: "01M4T6BQ9DJH2BCV6Q28GH4HK5",
      kind: "near_miss",
      description: "defineConfig callback is not a static config.",
      fixture: { "src/history.test.ts": applicableTest, "vitest.config.ts": functionConfig },
      expected: "unknown",
    }),
  ];
}

export function guardInput(overrides: Partial<{
  contract_id: string | undefined;
  files: Record<string, string>;
  resolved_versions: Record<string, string> | null;
  node_version: string | undefined;
  similarity: number | undefined;
}> = {}) {
  return {
    contract_id: CONTRACT_ID as string | undefined,
    files: applicableFiles(),
    resolved_versions: { ...APPLICABLE_VERSIONS } as Record<string, string> | null,
    node_version: "v24.8.0" as string | undefined,
    ...overrides,
  };
}

const verified: ReceiptT["verifier"] = {
  status: "verified",
  exit_code: 0,
  tests: { total: 3, passed: 3, failed: 0, skipped: 0, todo: 0 },
  required_passed: ["history-cleared", "spy-restored", "impl-kept"],
  protected_paths_modified: [],
};

export function receiptDraft(record: CapabilityRecordT, guard: GuardResultT, overrides: Record<string, unknown> = {}) {
  return {
    format: "receipt/1",
    id: "01M4T6BQ9DJH2BCV6Q28GH4HJA",
    capability_id: record.id,
    recipient: { label: "fixture", source_tree_hash: sha256Hex("src"), lockfile_hash: sha256Hex("lock") },
    program_hash: programHash(record.artifact.program),
    verifier_hash: verifierHash(record.artifact.verifier),
    counterexamples_hash: counterexamplesHash(record.counterexamples),
    resolved_versions: { vitest: "4.0.0", vite: "7.1.11" },
    runtime: {
      node_version: "v24.1.2",
      image: "node:24-slim",
      image_digest: sha256Hex("image"),
      platform: "linux/amd64",
      network: "none",
    },
    guard,
    outcome: "executed",
    verifier: verified,
    verifier_runtime: { vitest_version: "4.0.0", vitest_path: "node_modules/vitest/vitest.mjs" },
    diff: { ref: "changes.patch", hash: sha256Hex("diff"), files_changed: 1 },
    durations_ms: { guard: 1, install: 2, program: 3, verifier: 4, total: 10 },
    model_calls: { count: 0, span: "guard_to_verifier" },
    started_at: "2026-10-25T00:00:00Z",
    finished_at: "2026-10-25T00:00:01Z",
    ...overrides,
  };
}

export function executedReceipt(record: CapabilityRecordT, guard: GuardResultT, overrides: Record<string, unknown> = {}): ReceiptT {
  return Receipt.parse(receiptDraft(record, guard, overrides));
}

export function reuseCurrent(record: CapabilityRecordT, nodeVersion = "v24.11.0") {
  const receipt = {
    source_tree_hash: sha256Hex("src"),
    lockfile_hash: sha256Hex("lock"),
    node_version: nodeVersion,
    dependency_ids: record.artifact.dependencies.capabilities,
  };
  return receipt;
}
