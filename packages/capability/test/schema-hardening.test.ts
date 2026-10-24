import { describe, expect, it } from "vitest";
import { globMatch } from "../src/glob.ts";
import {
  CapabilityArtifact,
  FIXED_PROTECTED_GLOBS,
  Guard,
  RECIPIENT_TEST_GLOBS,
  PinnedImage,
  Receipt,
  VerifierRuntime,
  effectiveProtectedPaths,
  globsMayOverlap,
  imageDigest,
} from "../src/schema.ts";

const HEX = "a".repeat(64);
const SHA = (ch = "a") => `sha256:${ch.repeat(64)}`;
const COMMIT = "21321cb".padEnd(40, "0");
const IMAGE = `node@sha256:${HEX}`;
const ULID = "01M4T6BQ9DJH2BCV6Q28GH4HJA";
const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const REALPATH = "/verifier/node_modules/vitest/package.json";

const FAIL_GLOBS = [
  "/etc/**",
  "\\x\\**",
  "C:/x/**",
  "c:\\x",
  "../**",
  "a/../../b",
  "src/..",
  "src/../tools/verify/x.ts",
  "tools%2Fverify/x.ts",
  "a\u0000b",
  "a\\b",
  "{..,x}/y",
  "a//b",
  "x/[ab].ts",
  "*".repeat(13),
  "tools/verify./x.ts",
  "src.",
  "tools~1/verify/x.ts",
];

const PASS_GLOBS = [
  "src/**/*.test.ts",
  "test/**",
  "**/*.ts",
  "a..b/*.ts",
  "**/*.{test,spec}.{ts,mts,js,mjs}",
  "vitest.config.*",
];

const REJECTED_WRITES = [
  "src/**/*.test.ts",
  "Tools/Verify/x.ts",
  "tools/verify/.hidden/x",
  ".GitHub/workflows/a.yml",
  "packages/x/package.json",
  "vitest.config.ts",
  "pkg/tsconfig.build.json",
  ".ludion-verify/a.test.ts",
  "**/*.ts",
];

function baseArtifact() {
  return {
    format: "capability/1",
    contract: {
      id: "mock_cleanup.clear_history",
      intent: "Clear mock call history from the target.",
      pre: ["history is present"],
      post: [{ statement: "history is cleared", verified_by: ["history-cleared"] }],
      excludes: [] as string[],
    },
    guard: {
      contract_id: "mock_cleanup.clear_history",
      structure: [
        {
          kind: "call" as const,
          target: { module: "history", export: "clearHistory", member: [] as string[] },
          files: ["**/*.{test,spec}.{ts,mts,js,mjs}"],
          presence: "required" as const,
          binding: "import_resolved" as const,
        },
      ],
      packages: [
        {
          ecosystem: "npm" as const,
          name: "vitest",
          applicable_versions: ["4.0.0"],
          inapplicable_versions: [] as string[],
        },
      ],
      runtime: { node_major: ["24"] },
    },
    program: {
      kind: "codemod.ts-ast" as const,
      entry: "src/codemod.ts",
      files: { "src/codemod.ts": "export {}\n" } as Record<string, string>,
      effects: {
        writes: ["src/*.test.ts", "test/*.test.ts"],
        network: false as const,
        env: [] as string[],
        spawn: false as const,
      },
      timeout_ms: 30_000,
    },
    verifier: {
      kind: "vitest-run" as const,
      source: {
        repo: "Ludion-ai/ludion" as const,
        main_commit: COMMIT,
        tools_verify_hash: SHA("c"),
      },
      files: { "contract.test.mjs": "x" },
      mount_at: ".ludion-verify",
      argv: ["vitest", "run"],
      required_tests: ["history-cleared"],
      run_recipient_tests: false,
      protected_paths: [] as string[],
      allow_skip: false as const,
      timeout_ms: 120_000,
    },
    dependencies: {
      capabilities: [] as string[],
      image: IMAGE,
    },
    invalidates_on: ["program_changed", "verifier_changed", "dependency_changed", "counterexample_added"],
  };
}

type Artifact = ReturnType<typeof baseArtifact>;

function parseArtifact(mutate?: (a: Artifact) => void) {
  const a = baseArtifact();
  mutate?.(a);
  return CapabilityArtifact.safeParse(a);
}

function messages(parsed: ReturnType<typeof parseArtifact>): string {
  return parsed.success ? "ok" : parsed.error.issues.map((i) => i.message).join("\n");
}

function applicableGuard() {
  return {
    status: "applicable" as const,
    reason: "all_conditions_met" as const,
    matches: [{ file: "src/a.test.ts", line: 1, via: "import" as const }],
    detail: "ok",
    checks: [] as { condition: string; ok: boolean | null; note?: string }[],
  };
}

function verifiedResult(required: string[] = ["history-cleared"]) {
  return {
    status: "verified" as const,
    exit_code: 0,
    tests: { total: 1, passed: 1, failed: 0, skipped: 0, todo: 0 },
    required_passed: required,
    protected_paths_modified: [] as string[],
  };
}

function runtime(digest = SHA("a"), image = IMAGE) {
  return {
    node_version: "v24.1.2",
    image,
    image_digest: digest,
    platform: "linux/amd64",
    network: "none" as const,
  };
}

function verifierRuntime(realpath = REALPATH, integrity = INTEGRITY) {
  return {
    vitest_location: "verifier_store" as const,
    vitest_realpath: realpath,
    vitest_version: "4.0.0",
    vitest_integrity: integrity,
    lockfile_sha256: "b".repeat(64),
  };
}

function executedReceipt() {
  return {
    format: "receipt/1" as const,
    id: ULID,
    capability_id: `cap:${SHA("d")}`,
    recipient: { label: "fixture", source_tree_hash: SHA("e"), lockfile_hash: SHA("f") },
    program_hash: SHA("1"),
    verifier_hash: SHA("2"),
    counterexamples_hash: SHA("3"),
    resolved_versions: { vitest: "4.0.0" },
    runtime: runtime(),
    guard: applicableGuard(),
    outcome: "executed" as const,
    verifier: verifiedResult(),
    verifier_runtime: verifierRuntime(),
    diff: { ref: "src/a.test.ts", hash: SHA("9"), files_changed: 1 },
    durations_ms: { guard: 1, install: 1, program: 1, verifier: 1, total: 4 },
    model_calls: { count: 0, span: "guard_to_verifier" as const },
    started_at: "2026-10-25T00:00:00Z",
    finished_at: "2026-10-25T00:00:01Z",
  };
}

function notExecutedReceipt() {
  const r = executedReceipt();
  return {
    ...r,
    outcome: "not_executed" as const,
    runtime: null,
    verifier: null,
    verifier_runtime: null,
    diff: null,
  };
}

describe("1 glob syntax", () => {
  it("rejects unsafe globs in writes and protected_paths", () => {
    for (const g of FAIL_GLOBS) {
      const asWrite = parseArtifact((a) => {
        a.program.effects.writes = [g];
      });
      const asProtect = parseArtifact((a) => {
        a.verifier.protected_paths = [g];
      });
      expect({ g, write: asWrite.success, protect: asProtect.success }).toEqual({ g, write: false, protect: false });
    }
  });

  it("accepts safe globs as producer protected_paths", () => {
    for (const g of PASS_GLOBS) {
      const parsed = parseArtifact((a) => {
        a.program.effects.writes = ["lib/*.md"];
        a.verifier.protected_paths = [g];
      });
      expect(messages(parsed)).toBe("ok");
    }
  });

  it("rejects empty segments, dot segments, drives, and non-NFC file keys", () => {
    expect(parseArtifact((a) => {
      a.program.files = { "a//b.ts": "x" };
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.program.files = { "src/../x.ts": "x" };
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.program.files = { "C:/x.ts": "x" };
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.program.files = { "cafe\u0301.ts": "x" };
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.program.files = { "src/a.ts": "\uD800" };
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.program.files = { "A.ts": "1", "a.ts": "2" };
    }).success).toBe(false);
  });
});

describe("1b case-insensitive overlap and percent encoding", () => {
  it("overlaps Tools/Verify with tools/verify and does not decode %2F", () => {
    expect(globsMayOverlap("Tools/Verify/x.ts", "tools/verify/**")).toBe(true);
    expect(parseArtifact((a) => {
      a.program.effects.writes = ["Tools/Verify/x.ts"];
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.program.effects.writes = ["tools%2Fverify/x.ts"];
    }).success).toBe(false);
    expect(globsMayOverlap("tools%2Fverify/x.ts", "tools/verify/**")).toBe(false);
  });
});

describe("2 fixed denylist", () => {
  it("accepts narrow test writes and rejects denylist reaches", () => {
    expect(messages(parseArtifact())).toBe("ok");
    expect(parseArtifact((a) => {
      a.program.effects.writes = ["src/*.test.ts"];
    }).success).toBe(true);
    expect(parseArtifact((a) => {
      a.program.effects.writes = ["test/*.test.ts"];
    }).success).toBe(true);
    for (const g of REJECTED_WRITES) {
      const parsed = parseArtifact((a) => {
        a.program.effects.writes = [g];
        a.verifier.protected_paths = [];
      });
      expect({ g, ok: parsed.success }).toEqual({ g, ok: false });
    }
  });

  it("rejects .git files, submodule and package-manager hooks at any depth and case", () => {
    const rejected = [
      ".git",
      "sub/.git",
      ".GIT",
      "a/b/.Git",
      ".gitmodules",
      "sub/.gitmodules",
      ".yarnrc",
      ".yarnrc.yml",
      ".YARNRC.yaml",
      "pkg/.yarnrc.yml",
      ".pnpmfile.cjs",
      "pkg/.pnpmfile.cjs",
      ".husky/pre-commit",
      "pkg/.husky/_/husky.sh",
    ];
    for (const g of rejected) {
      const parsed = parseArtifact((a) => {
        a.program.effects.writes = [g];
        a.verifier.protected_paths = [];
      });
      expect({ g, ok: parsed.success }).toEqual({ g, ok: false });
      expect(messages(parsed)).toContain("overlaps protected glob");
    }
    for (const g of ["src/git.ts", "src/gitmodules.test.ts", "src/yarnrc.test.ts", "src/husky.test.ts"]) {
      const parsed = parseArtifact((a) => {
        a.program.effects.writes = [g];
        a.verifier.protected_paths = [];
      });
      expect({ g, ok: parsed.success }).toEqual({ g, ok: true });
    }
    for (const g of ["**/.git", "**/.gitmodules", "**/.yarnrc", "**/.yarnrc.yml", "**/.pnpmfile.cjs", "**/.husky/**"]) {
      expect(FIXED_PROTECTED_GLOBS).toContain(g);
    }
    expect(globMatch("**/.git", ".git")).toBe(true);
    expect(globMatch("**/.git", "sub/.git")).toBe(true);
    expect(globMatch("**/.yarnrc.yml", "a/.yarnrc.yml")).toBe(true);
    expect(globMatch("**/.husky/**", ".husky/pre-commit")).toBe(true);
  });

  it("protects recipient test files only when recipient tests are run", () => {
    const writes = [
      "src/*.test.ts",
      "src/*.spec.tsx",
      "test/*.test.mjs",
      "lib/a.spec.cjs",
      "src/a.test.mts",
      "src/a.test.cts",
      "src/a.test.js",
      "src/__tests__/*.test.ts",
      "src/__tests__/helper.ts",
    ];
    for (const g of writes) {
      const off = parseArtifact((a) => {
        a.verifier.run_recipient_tests = false;
        a.program.effects.writes = [g];
      });
      expect({ g, ok: off.success, m: messages(off) }).toEqual({ g, ok: true, m: "ok" });
      const on = parseArtifact((a) => {
        a.verifier.run_recipient_tests = true;
        a.program.effects.writes = [g];
      });
      expect({ g, ok: on.success }).toEqual({ g, ok: false });
      expect(messages(on)).toContain("overlaps protected glob");
    }
    for (const g of ["src/*.ts", "src/history.ts", "src/testing/helper.ts", "src/a.testing.ts"]) {
      const on = parseArtifact((a) => {
        a.verifier.run_recipient_tests = true;
        a.program.effects.writes = [g];
      });
      // src/*.ts can still name src/a.test.ts, so only literal non-test paths stay accepted.
      expect({ g, ok: on.success }).toEqual({ g, ok: g !== "src/*.ts" });
    }
    expect(effectiveProtectedPaths({ protected_paths: [], run_recipient_tests: true })).toEqual([...FIXED_PROTECTED_GLOBS, ...RECIPIENT_TEST_GLOBS]);
    for (const g of RECIPIENT_TEST_GLOBS) {
      expect(parseArtifact((a) => {
        a.program.effects.writes = ["src/history.ts"];
        a.verifier.protected_paths = [g];
      }).success, g).toBe(true);
    }
  });

  it("rejects tools/verify even when the producer lists no protected paths", () => {
    const parsed = parseArtifact((a) => {
      a.verifier.protected_paths = [];
      a.program.effects.writes = ["tools/verify/x.ts"];
    });
    expect(parsed.success).toBe(false);
    expect(effectiveProtectedPaths({ protected_paths: [] })).toEqual([...FIXED_PROTECTED_GLOBS]);
  });

  it("accepts every fixed protected glob", () => {
    for (const g of FIXED_PROTECTED_GLOBS) {
      const parsed = parseArtifact((a) => {
        a.verifier.protected_paths = [g];
      });
      expect(parsed.success ? "ok" : `${g}\n${messages(parsed)}`).toBe("ok");
    }
  });

  it("rejects mount_at other than the verifier mount", () => {
    expect(parseArtifact((a) => {
      a.verifier.mount_at = "node_modules/vitest";
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.verifier.mount_at = "other";
    }).success).toBe(false);
  });
});

describe("3 argv and source", () => {
  it("pins argv[0] to vitest and main_commit to 40 lowercase hex", () => {
    expect(messages(parseArtifact())).toBe("ok");
    expect(parseArtifact((a) => {
      a.verifier.argv = ["vitest", "run", "--config", "x"];
    }).success).toBe(true);
    for (const argv of [["sh", "-c", "x"], ["node", "node_modules/vitest/vitest.mjs", "run"], []] as string[][]) {
      expect(parseArtifact((a) => {
        a.verifier.argv = argv;
      }).success).toBe(false);
    }
    expect(parseArtifact((a) => {
      a.verifier.source.main_commit = "a".repeat(39);
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      a.verifier.source.main_commit = "A".repeat(40);
    }).success).toBe(false);
    expect(parseArtifact((a) => {
      delete (a.verifier as { source?: unknown }).source;
    }).success).toBe(false);
  });
});

describe("5 pinned image", () => {
  const pass = [IMAGE, `docker.io/library/node:24-slim@sha256:${HEX}`];
  const fail = [
    "node:24-slim",
    "node:latest",
    "node",
    `node@sha256:${"a".repeat(63)}`,
    `node@sha256:${"A".repeat(64)}`,
    `@sha256:${HEX}`,
    `${IMAGE}0`,
  ];

  it("accepts digest-pinned refs and rejects tags and bad digests", () => {
    for (const ref of pass) expect(PinnedImage.safeParse(ref).success, ref).toBe(true);
    for (const ref of fail) expect(PinnedImage.safeParse(ref).success, ref).toBe(false);
    expect(imageDigest(IMAGE)).toBe(SHA("a"));
    expect(parseArtifact((a) => {
      a.dependencies.image = "node:24-slim";
    }).success).toBe(false);
    const mismatch = executedReceipt();
    mismatch.runtime = runtime(SHA("b"), IMAGE);
    expect(Receipt.safeParse(mismatch).success).toBe(false);
    expect(Receipt.safeParse(executedReceipt()).success).toBe(true);
  });
});

describe("8 receipt outcomes", () => {
  it("accepts executed and not_executed and rejects crossed fields", () => {
    expect(Receipt.safeParse(executedReceipt()).success).toBe(true);
    expect(Receipt.safeParse(notExecutedReceipt()).success).toBe(true);

    const withVerifier = notExecutedReceipt();
    (withVerifier as { verifier: unknown }).verifier = verifiedResult();
    expect(Receipt.safeParse(withVerifier).success).toBe(false);

    const withPayload = notExecutedReceipt();
    (withPayload as { runtime: unknown }).runtime = runtime();
    (withPayload as { diff: unknown }).diff = { ref: "src/a.test.ts", hash: SHA("9"), files_changed: 1 };
    (withPayload as { verifier_runtime: unknown }).verifier_runtime = verifierRuntime();
    expect(Receipt.safeParse(withPayload).success).toBe(false);

    const emptyRequired = executedReceipt();
    emptyRequired.verifier = verifiedResult([]);
    expect(Receipt.safeParse(emptyRequired).success).toBe(false);

    const duplicateRequired = executedReceipt();
    duplicateRequired.verifier = verifiedResult(["history-cleared", "history-cleared"]);
    expect(Receipt.safeParse(duplicateRequired).success).toBe(false);

    const noVerifier = executedReceipt();
    (noVerifier as { verifier: unknown }).verifier = null;
    expect(Receipt.safeParse(noVerifier).success).toBe(false);
  });
});

describe("C4 guard absolute paths", () => {
  it("rejects any root, drive, backslash or home path anywhere in the guard", () => {
    const base = baseArtifact().guard;
    expect(Guard.safeParse(base).success).toBe(true);
    const keyed = (key: string) => ({
      ...base,
      structure: [...base.structure, { kind: "config" as const, file: ["vitest.config.ts"], key, inapplicable_if: true }],
    });
    for (const key of ["/opt/x", "/srv/app", "/tmp", "/", "\\\\server\\share", "\\x", "C:\\x", "d:/x", "c:", "~/x", "~", "see C:\\x"]) {
      expect({ key, ok: Guard.safeParse(keyed(key)).success }).toEqual({ key, ok: false });
    }
    for (const key of ["clearMocks", "test.clearMocks", "a/b", "ab:c"]) {
      expect({ key, ok: Guard.safeParse(keyed(key)).success }).toEqual({ key, ok: true });
    }
    expect(Guard.safeParse({ ...base, contract_id: base.contract_id, packages: [{ ...base.packages[0], name: "/opt/vitest" }] }).success).toBe(false);
  });
});

describe("9 verifier runtime", () => {
  const badPaths = [
    "node_modules/vitest/vitest.mjs",
    "/work/node_modules/vitest/vitest.mjs",
    "/verifier/../work/node_modules/vitest/package.json",
    "/verifier/node_modules/../../x",
    "/verifier/a%2e%2e/x",
    "/verifier/a\u0000b",
    "/verifierx/node_modules/vitest/package.json",
    "/opt/ludion/verifier-store/node_modules/vitest/package.json",
    "C:/x",
    "/verifier/",
    "/verifier",
    "/verifier//vitest/package.json",
    "/verifier/node_modules/vitest/",
    "/verifier/./x",
    "/verifier/..",
  ];

  it("accepts a file one or more segments under the store", () => {
    for (const p of ["/verifier/x", "/verifier/node_modules/vitest/package.json"]) {
      expect(VerifierRuntime.safeParse(verifierRuntime(p)).success, p).toBe(true);
    }
  });

  it("pins the realpath under the verifier store and checks integrity", () => {
    expect(VerifierRuntime.safeParse(verifierRuntime()).success).toBe(true);
    for (const p of badPaths) {
      expect(VerifierRuntime.safeParse(verifierRuntime(p)).success, p).toBe(false);
    }
    expect(VerifierRuntime.safeParse(verifierRuntime(REALPATH, "sha512-abc")).success).toBe(false);
    for (const v of ["4.1.11", "4.2.0-beta.1", "4.1.11+build.5", "1.0.0-rc.1+sha.abc"]) {
      expect(VerifierRuntime.safeParse({ ...verifierRuntime(), vitest_version: v }).success, v).toBe(true);
    }
    for (const v of ["4.1", "v4.1.11", "4.1.11-", "04.1.11", "4.1.11+", "latest"]) {
      expect(VerifierRuntime.safeParse({ ...verifierRuntime(), vitest_version: v }).success, v).toBe(false);
    }
    expect(VerifierRuntime.safeParse({ ...verifierRuntime(), lockfile_sha256: SHA("b") }).success).toBe(false);
    expect(VerifierRuntime.safeParse({ ...verifierRuntime(), lockfile_sha256: "B".repeat(64) }).success).toBe(false);
    expect(VerifierRuntime.safeParse({ ...verifierRuntime(), vitest_location: "recipient" }).success).toBe(false);
    expect(VerifierRuntime.safeParse(verifierRuntime(REALPATH, `sha256-${"A".repeat(86)}==`)).success).toBe(false);
    expect(VerifierRuntime.safeParse(verifierRuntime(REALPATH, `sha512-${"A".repeat(85)}==`)).success).toBe(false);
  });
});

describe("13 timing", () => {
  it("matches and intersects star-heavy patterns quickly and rejects 13 stars", () => {
    const t0 = performance.now();
    globMatch("*".repeat(13) + "b", "a".repeat(60));
    expect(performance.now() - t0).toBeLessThan(200);

    const t1 = performance.now();
    globsMayOverlap("*".repeat(8), "a".repeat(60));
    expect(performance.now() - t1).toBeLessThan(200);

    expect(parseArtifact((a) => {
      a.program.effects.writes = ["*".repeat(13)];
    }).success).toBe(false);
  });
});

describe("14 dot directories", () => {
  it("lets ** enter dot-directories and overlap those paths", () => {
    expect(globMatch("tools/verify/**", "tools/verify/.hidden/x")).toBe(true);
    expect(globsMayOverlap("tools/verify/.hidden/x", "tools/verify/**")).toBe(true);
    expect(globMatch("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(globMatch("**/*.{test,spec}.ts", "src/a.spec.ts")).toBe(true);
    expect(globMatch("src/*.test.ts", "src/nested/a.test.ts")).toBe(false);
    expect(globMatch("src/*.test.ts", "./src\\a.test.ts")).toBe(true);
    expect(globsMayOverlap("src/*.test.ts", "**/node_modules/**")).toBe(false);
    expect(globsMayOverlap("src/**/*.test.ts", "**/node_modules/**")).toBe(true);
  });
});
