// Real Docker integration. Skipped unless LUDION_DOCKER_TESTS=1. Do not start Docker from a normal test run.
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateGuard, executeProgram, PINNED_VERSION_SET } from "../src/index.ts";
import { lockfileVersions } from "../src/executor.ts";
import { applicableTest, CONTRACT_ID, exampleArtifact, packageLock, reseal } from "./fixtures.ts";

const LOCK = packageLock({ vitest: PINNED_VERSION_SET.vitest, vite: PINNED_VERSION_SET.vite });
const NODE_VERSION = "v24.8.0";

const PROGRAM = [
  'import { readFileSync, writeFileSync } from "node:fs";',
  'import { request } from "node:http";',
  'const target = "/work/src/a.test.ts";',
  'writeFileSync(target, "// changed\\n" + readFileSync(target, "utf8"));',
  "function tryWrite(path) {",
  '  try { writeFileSync(path, "nope\\n"); return "wrote"; }',
  '  catch (err) { return "blocked:" + (err && err.code ? err.code : "error"); }',
  "}",
  'const other = tryWrite("/work/src/other.ts");',
  'const escape = tryWrite("/tmp-escape");',
  "const net = await new Promise((resolve) => {",
  '  const req = request("http://example.com/", { timeout: 3000 }, (res) => { res.resume(); resolve("ok"); });',
  '  req.on("error", () => resolve("blocked"));',
  '  req.on("timeout", () => { req.destroy(); resolve("blocked"); });',
  "  req.end();",
  "});",
  'if (other === "wrote" || escape === "wrote" || net === "ok") process.exitCode = 2;',
  "console.log(JSON.stringify({ other, escape, net }));",
  "",
].join("\n");

function programRecord(source: string, timeout_ms: number) {
  const base = exampleArtifact();
  return reseal({
    ...base,
    dependencies: { ...base.dependencies, image: PINNED_VERSION_SET.image },
    program: {
      kind: "codemod.ts-ast",
      entry: "run.mjs",
      files: { "run.mjs": source },
      effects: { writes: ["src/*.test.ts", "test/*.test.ts"], network: false, env: [], spawn: false },
      timeout_ms,
    },
  });
}

function workCopy(): { root: string; target: string; other: string; originalOther: string } {
  const root = mkdtempSync(join(tmpdir(), "ludion-docker-work-"));
  mkdirSync(join(root, "src"));
  const target = join(root, "src", "a.test.ts");
  const other = join(root, "src", "other.ts");
  const originalOther = "export const other = 1;\n";
  writeFileSync(target, applicableTest);
  writeFileSync(other, originalOther);
  writeFileSync(join(root, "package-lock.json"), LOCK);
  chmodSync(root, 0o777);
  chmodSync(join(root, "src"), 0o777);
  chmodSync(target, 0o666);
  chmodSync(other, 0o666);
  return { root, target, other, originalOther };
}

describe.skipIf(process.env.LUDION_DOCKER_TESTS !== "1")("program executor in Docker", () => {
  it("writes only the read-write file and cannot leave the mount or the network", async () => {
    const work = workCopy();
    try {
      const record = programRecord(PROGRAM, 60_000);
      const result = await executeProgram({
        record,
        contract_id: CONTRACT_ID,
        workDir: work.root,
        node_version: NODE_VERSION,
      });
      expect(result).toMatchObject({ outcome: "executed", status: "ok", model_calls: { count: 0 } });
      if (result.outcome !== "executed") return;
      expect(result.evidence.timed_out).toBe(false);
      expect(result.changed_files).toEqual(["src/a.test.ts"]);
      // The container wrote to the executor's private snapshot; the caller's tree is untouched.
      expect(result.evidence.diff).toHaveLength(1);
      expect(result.evidence.diff[0]?.after).toBe(`// changed\n${applicableTest}`);
      // The executor evaluated the guard on this same work copy (files and lockfile), right before running.
      const expectedGuard = evaluateGuard(record, {
        contract_id: CONTRACT_ID,
        files: { "package-lock.json": LOCK, "src/a.test.ts": applicableTest, "src/other.ts": work.originalOther },
        resolved_versions: lockfileVersions(LOCK),
        node_version: NODE_VERSION,
      });
      expect(expectedGuard.status).toBe("applicable");
      expect(result.guard).toEqual(expectedGuard);
      expect(readFileSync(work.target, "utf8")).toBe(applicableTest);
      expect(readFileSync(work.other, "utf8")).toBe(work.originalOther);
      const report = JSON.parse(result.evidence.stdout_tail) as { other: string; escape: string; net: string };
      expect(report.other.startsWith("blocked")).toBe(true);
      expect(report.escape.startsWith("blocked")).toBe(true);
      expect(report.net).toBe("blocked");
    } finally {
      rmSync(work.root, { recursive: true, force: true });
    }
  }, 120_000);

  it("times out a program that never exits", async () => {
    const work = workCopy();
    try {
      const record = programRecord("setInterval(() => {}, 1000);\n", 2_000);
      const result = await executeProgram({
        record,
        contract_id: CONTRACT_ID,
        workDir: work.root,
        node_version: NODE_VERSION,
      });
      expect(result).toMatchObject({ outcome: "executed", status: "timeout", model_calls: { count: 0 } });
      if (result.outcome === "executed") expect(result.evidence.timed_out).toBe(true);
    } finally {
      rmSync(work.root, { recursive: true, force: true });
    }
  }, 120_000);
});
