import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateLesson } from "@ludion/core";
import { CapabilityArtifact, CapabilityRecord, Guard } from "../src/index.ts";
import { capabilitySchemaJson, receiptSchemaJson } from "../scripts/gen-json-schema.ts";
import { exampleArtifactInput, exampleRecord } from "./fixtures.ts";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
/** sha256 of sorted `path\\ncontent\\n` for lessons/** and packages/core/src/generated/**, with CRLF normalized to LF.
 *  Computed before this package existed. */
const LESSON_TREE_SHA256 = "ced7ad161abdff4652f4ac2a008cce82d32d75d60fca30cf19285e0fef1f882e";

function treeHash(roots: string[]): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(REPO, path).replaceAll("\\", "/"));
    }
  };
  for (const root of roots) walk(join(REPO, root));
  files.sort();
  const hash = createHash("sha256");
  for (const rel of files) {
    const text = readFileSync(join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
    hash.update(`${rel}\n${text}\n`);
  }
  return hash.digest("hex");
}

describe("guard portability and write boundary", () => {
  it("rejects hashes, long hex, absolute paths, ranges, and version overlap", () => {
    const base = exampleArtifactInput().guard;
    expect(Guard.safeParse(base).success).toBe(true);
    expect(Guard.safeParse({ ...base, structure: [{ ...base.structure[0], files: ["sha256:abcd"] }] }).success).toBe(false);
    expect(Guard.safeParse({ ...base, packages: [{ ...base.packages[0], name: "a".repeat(40) }] }).success).toBe(false);
    for (const files of [["C:\\repo\\**"], ["/home/dev/**"], ["/w/restore/**"]]) {
      const structure = base.structure.map((condition, index) => index === 0 && condition.kind === "call" ? { ...condition, files } : condition);
      expect(Guard.safeParse({ ...base, structure }).success, files[0]).toBe(false);
    }
    expect(Guard.safeParse({
      ...base,
      packages: [{ ...base.packages[0], applicable_versions: [">=4.0.0"] }],
    }).success).toBe(false);
    expect(Guard.safeParse({
      ...base,
      packages: [{ ...base.packages[0], applicable_versions: ["4.0.0"], inapplicable_versions: ["4.0.0"] }],
    }).success).toBe(false);
  });

  it("rejects writes that overlap the fixed denylist and a mount other than the fixed mount", () => {
    const artifact = exampleArtifactInput();
    expect(CapabilityArtifact.safeParse(artifact).success).toBe(true);
    for (const writes of [["**/*.{test,spec}.*"], [".ludion-verify/**"], ["src/**/*.test.ts"], ["tools/verify/**"], ["tools/verify/x.ts"]]) {
      expect(CapabilityArtifact.safeParse({
        ...artifact,
        program: { ...artifact.program, effects: { ...artifact.program.effects, writes } },
      }).success, writes[0]).toBe(false);
    }
    expect(CapabilityArtifact.safeParse({
      ...artifact,
      program: { ...artifact.program, effects: { ...artifact.program.effects, writes: ["src/*.test.ts", "test/*.test.ts"] } },
    }).success).toBe(true);
    expect(CapabilityArtifact.safeParse({
      ...artifact,
      verifier: { ...artifact.verifier, mount_at: "other" },
    }).success).toBe(false);
    // Producer extras do not replace the fixed denylist, and the mount stays .ludion-verify.
    expect(CapabilityArtifact.safeParse({
      ...artifact,
      verifier: { ...artifact.verifier, protected_paths: ["other/**"] },
    }).success).toBe(true);
  });
});

describe("generated JSON schema", () => {
  it("matches the committed capability and receipt schemas", () => {
    const dir = fileURLToPath(new URL("..", import.meta.url));
    expect(readFileSync(join(dir, "capability.schema.json"), "utf8")).toBe(capabilitySchemaJson());
    expect(readFileSync(join(dir, "receipt.schema.json"), "utf8")).toBe(receiptSchemaJson());
  });
});

describe("lesson boundary", () => {
  it("keeps lessons and core generated validators byte-stable and does not mix formats", () => {
    expect(treeHash(["lessons", "packages/core/src/generated"])).toBe(LESSON_TREE_SHA256);
    const lesson = JSON.parse(readFileSync(join(REPO, "lessons/vitest/01M4T6BQ9DJH2BCV6Q28GH4HJ1.json"), "utf8")) as unknown;
    expect(CapabilityRecord.safeParse(lesson).success).toBe(false);
    expect(validateLesson(exampleRecord()).ok).toBe(false);
  });
});
