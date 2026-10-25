import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildVerifierVitestArgv, judgeVitestReport, validateArtifactArgv, type VerifierVitestContext } from "../src/vitest-argv.ts";

const RUNNER_CONFIG = fileURLToPath(new URL("../runner/vitest.runner.config.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));

function withTemp(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ludion-argv-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectRejected(argv: string[], token: string): void {
  let message = "";
  try {
    validateArtifactArgv(argv);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message, JSON.stringify(argv)).toContain(JSON.stringify(token));
}

function layout(parent: string): { recipient: string; verifier: string; ctx: VerifierVitestContext } {
  const recipient = join(parent, "recipient");
  const verifier = join(parent, "verifier");
  const deps = join(parent, "deps");
  mkdirSync(recipient);
  mkdirSync(verifier);
  mkdirSync(deps);
  const configPath = join(verifier, "vitest.runner.config.mjs");
  const vitestPath = join(deps, "vitest.mjs");
  const reportPath = join(parent, "report.json");
  writeFileSync(configPath, "export default { test: { allowOnly: false } };\n");
  writeFileSync(vitestPath, "#!/usr/bin/env node\n");
  return {
    recipient,
    verifier,
    ctx: { recipientRoot: recipient, verifierRoot: verifier, vitestPath, configPath, reportPath },
  };
}

describe("buildVerifierVitestArgv", () => {
  it("puts the runner's vitest, config, root, reporter, filter, and files in that order", () => {
    withTemp((parent) => {
      const { recipient, ctx } = layout(parent);
      const argv = buildVerifierVitestArgv({ files: ["src/a.test.ts", "src/b.test.ts"], testNamePattern: "adds two" }, ctx);
      expect(argv).toEqual([
        ctx.vitestPath,
        "run",
        "--allowOnly=false",
        `--config=${ctx.configPath}`,
        `--root=${recipient}`,
        "--reporter=json",
        `--outputFile=${ctx.reportPath}`,
        "--testNamePattern=adds two",
        "src/a.test.ts",
        "src/b.test.ts",
      ]);
      expect(argv).not.toContain("-t");
      expect(argv).not.toContain("--config");
      expect(argv).not.toContain("--root");
      expect(argv).not.toContain("--reporter");
      expect(argv).not.toContain("--outputFile");
      expect(argv).not.toContain("--passWithNoTests");
      expect(argv).not.toContain("--watch");
      expect(argv).not.toContain("--update");
      expect(argv).not.toContain("--allowOnly");
      const plain = buildVerifierVitestArgv({ files: ["a.test.ts"] }, ctx);
      expect(plain).toEqual([
        ctx.vitestPath,
        "run",
        "--allowOnly=false",
        `--config=${ctx.configPath}`,
        `--root=${recipient}`,
        "--reporter=json",
        `--outputFile=${ctx.reportPath}`,
        "a.test.ts",
      ]);
    });
  });

  it("ships a runner config that imports nothing and is passed as --config and --root", () => {
    const text = readFileSync(RUNNER_CONFIG, "utf8");
    const code = text.replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b/);
    expect(code).not.toMatch(/setupFiles|globalSetup|\bplugins\b|\bprojects\b|\bworkspace\b/);
    expect(text).toMatch(/allowOnly:\s*false/);
    withTemp((parent) => {
      const recipient = join(parent, "recipient");
      mkdirSync(recipient);
      const reportPath = join(parent, "report.json");
      const vitestPath = join(parent, "vitest.mjs");
      writeFileSync(vitestPath, "");
      const argv = buildVerifierVitestArgv(
        { files: ["a.test.ts"] },
        { recipientRoot: recipient, verifierRoot: REPO, vitestPath, configPath: RUNNER_CONFIG, reportPath },
      );
      expect(argv).toContain(`--config=${RUNNER_CONFIG}`);
      expect(argv).toContain(`--root=${recipient}`);
      expect(() => buildVerifierVitestArgv(
        { files: ["a.test.ts"] },
        { recipientRoot: REPO, verifierRoot: REPO, vitestPath, configPath: RUNNER_CONFIG, reportPath: join(REPO, "report.json") },
      )).toThrow(/configPath must not be inside the recipient/);
    });
  });

  it("rejects a vitest, config, or report path in the wrong tree", () => {
    withTemp((parent) => {
      const { recipient, ctx } = layout(parent);
      const nested = join(recipient, ".verifier");
      const insideVitest = join(recipient, "node_modules", "vitest", "vitest.mjs");
      const nestedConfig = join(nested, "vitest.config.ts");
      const outsideConfig = join(parent, "other.config.ts");
      mkdirSync(join(recipient, "node_modules", "vitest"), { recursive: true });
      mkdirSync(nested, { recursive: true });
      writeFileSync(insideVitest, "");
      writeFileSync(nestedConfig, "");
      writeFileSync(outsideConfig, "");
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, vitestPath: insideVitest })).toThrow(/vitestPath must not be inside the recipient/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, verifierRoot: nested, configPath: nestedConfig })).toThrow(/configPath must not be inside the recipient/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, configPath: outsideConfig })).toThrow(/configPath must be inside the verifier root/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, reportPath: join(recipient, "report.json") })).toThrow(/reportPath must not be inside the recipient/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], configPath: ctx.configPath } as { files: string[] }, ctx)).toThrow(/Unknown request field configPath/);
      expect(() => buildVerifierVitestArgv({ files: [] }, ctx)).toThrow(/non-empty/);
      expect(() => buildVerifierVitestArgv({ files: ["../a.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["-secret.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["C:/a.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["/tmp/a.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["a\nb.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["$(id).test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "-evil" }, ctx)).toThrow(/Invalid testNamePattern/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "" }, ctx)).toThrow(/Invalid testNamePattern/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "a".repeat(257) }, ctx)).toThrow(/Invalid testNamePattern/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "a\nb" }, ctx)).toThrow(/Invalid testNamePattern/);
      const pattern = "a".repeat(256);
      expect(buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: pattern }, ctx)).toContain(`--testNamePattern=${pattern}`);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, configPath: "vitest.config.ts" })).toThrow(/configPath must be an absolute path/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, reportPath: "report.json" })).toThrow(/reportPath must be an absolute path/);
    });
  });
});

describe("validateArtifactArgv", () => {
  it("accepts only a vitest run, file filters, and one test-name pattern", () => {
    expect(validateArtifactArgv(["vitest", "run", "src/a.test.ts"])).toEqual({ files: ["src/a.test.ts"] });
    expect(validateArtifactArgv(["vitest", "src/a.test.ts"])).toEqual({ files: ["src/a.test.ts"] });
    expect(validateArtifactArgv(["run", "src/a.test.ts"])).toEqual({ files: ["src/a.test.ts"] });
    expect(validateArtifactArgv(["src/a.test.ts", "src/b.test.ts"])).toEqual({ files: ["src/a.test.ts", "src/b.test.ts"] });
    expect(validateArtifactArgv(["./src/a.test.ts"])).toEqual({ files: ["./src/a.test.ts"] });
    expect(validateArtifactArgv(["vitest", "run", "-t", "adds two", "src/a.test.ts"])).toEqual({
      files: ["src/a.test.ts"],
      testNamePattern: "adds two",
    });
    expect(validateArtifactArgv(["vitest", "run", "--testNamePattern", "adds two", "src/a.test.ts"])).toEqual({
      files: ["src/a.test.ts"],
      testNamePattern: "adds two",
    });
    expect(validateArtifactArgv(["vitest", "run", "--testNamePattern=adds two", "src/a.test.ts", "src/b.test.ts"])).toEqual({
      files: ["src/a.test.ts", "src/b.test.ts"],
      testNamePattern: "adds two",
    });
    expect(validateArtifactArgv(["src/a.test.ts", "-t", "name", "src/b.test.ts"])).toEqual({
      files: ["src/a.test.ts", "src/b.test.ts"],
      testNamePattern: "name",
    });
    expect(validateArtifactArgv(["vitest", "run", "--testNamePattern=foo|bar", "a.test.ts"])).toEqual({
      files: ["a.test.ts"],
      testNamePattern: "foo|bar",
    });
    const long = "n".repeat(256);
    expect(validateArtifactArgv(["a.test.ts", "-t", long]).testNamePattern).toBe(long);
    expect(validateArtifactArgv(["node/foo.test.ts"])).toEqual({ files: ["node/foo.test.ts"] });
    expect(validateArtifactArgv(["npm-utils.test.ts"])).toEqual({ files: ["npm-utils.test.ts"] });
    expect(validateArtifactArgv(["bash.test.ts"])).toEqual({ files: ["bash.test.ts"] });
    expect(validateArtifactArgv(["sh.test.ts"])).toEqual({ files: ["sh.test.ts"] });
    expect(validateArtifactArgv(["src/file+name.test.ts"])).toEqual({ files: ["src/file+name.test.ts"] });
  });

  it("names the offending token for every flag, shell, and case variant outside the allowlist", () => {
    const cases: [string[], string][] = [
      [["--passWithNoTests"], "--passWithNoTests"],
      [["--passWithNoTests=true"], "--passWithNoTests=true"],
      [["--passWithNoTests=false"], "--passWithNoTests=false"],
      [["--PassWithNoTests"], "--PassWithNoTests"],
      [["--passWithNoTests "], "--passWithNoTests "],
      [["vitest", "run", "--passWithNoTests", "a.test.ts"], "--passWithNoTests"],
      [["--config", "vitest.config.ts"], "--config"],
      [["--config=vitest.config.ts"], "--config=vitest.config.ts"],
      [["-c", "vitest.config.ts"], "-c"],
      [["-c=vitest.config.ts"], "-c=vitest.config.ts"],
      [["--CONFIG", "vitest.config.ts"], "--CONFIG"],
      [["--config\n"], "--config\n"],
      [["--root", "/tmp"], "--root"],
      [["-r", "/tmp"], "-r"],
      [["--dir", "src"], "--dir"],
      [["--update"], "--update"],
      [["-u"], "-u"],
      [["--allowOnly"], "--allowOnly"],
      [["--allowOnly=false"], "--allowOnly=false"],
      [["--allowOnly=true"], "--allowOnly=true"],
      [["--exclude", "x"], "--exclude"],
      [["--changed"], "--changed"],
      [["--related", "a.ts"], "--related"],
      [["--shard", "1/2"], "--shard"],
      [["--bail"], "--bail"],
      [["--silent"], "--silent"],
      [["--typecheck"], "--typecheck"],
      [["--environment", "node"], "--environment"],
      [["--pool", "forks"], "--pool"],
      [["--globals"], "--globals"],
      [["--watch"], "--watch"],
      [["-w"], "-w"],
      [["--inspect"], "--inspect"],
      [["--coverage"], "--coverage"],
      [["--coverage.enabled"], "--coverage.enabled"],
      [["--coverage=true"], "--coverage=true"],
      [["--reporter", "json"], "--reporter"],
      [["--reporter=json", "a.test.ts"], "--reporter=json"],
      [["--outputFile", "out.json"], "--outputFile"],
      [["--outputFile=out.json", "a.test.ts"], "--outputFile=out.json"],
      [["--coverage.provider=v8"], "--coverage.provider=v8"],
      [["--mode", "development"], "--mode"],
      [["--project", "node"], "--project"],
      [["--project=node"], "--project=node"],
      [["--run=false"], "--run=false"],
      [["vitest", "--run=false", "a.test.ts"], "--run=false"],
      [["--no-color"], "--no-color"],
      [["--no-file-parallelism"], "--no-file-parallelism"],
      [["vitest\n", "a.test.ts"], "vitest\n"],
      [["vitest ", "a.test.ts"], "vitest "],
      [["-uc"], "-uc"],
      [["vitest", "run", "-uc", "a.test.ts"], "-uc"],
      [["-t=name", "a.test.ts"], "-t=name"],
      [["sh"], "sh"],
      [["sh", "-c", "rm -rf /"], "sh"],
      [["sh -c echo hi"], "sh -c echo hi"],
      [["bash"], "bash"],
      [["node", "a.test.ts"], "node"],
      [["npx", "vitest"], "npx"],
      [["pnpm", "vitest"], "pnpm"],
      [["npm", "test"], "npm"],
      [["cmd"], "cmd"],
      [["powershell"], "powershell"],
      [["/bin/sh"], "/bin/sh"],
      [["/usr/local/bin/vitest"], "/usr/local/bin/vitest"],
      [["node_modules/vitest/vitest.mjs", "a.test.ts"], "node_modules/vitest/vitest.mjs"],
      [["./node_modules/.bin/vitest"], "./node_modules/.bin/vitest"],
      [["C:\\deps\\vitest.mjs"], "C:\\deps\\vitest.mjs"],
      [["&&"], "&&"],
      [[";"], ";"],
      [["|"], "|"],
      [["vitest", "run", "a.test.ts", "&&"], "&&"],
      [["vitest", "run", "a.test.ts", ";"], ";"],
      [["vitest", "run", "|"], "|"],
      [["vitest", "run", "foo;bar.test.ts"], "foo;bar.test.ts"],
      [["../a.test.ts"], "../a.test.ts"],
      [["src/../../etc/passwd"], "src/../../etc/passwd"],
      [["/tmp/a.test.ts"], "/tmp/a.test.ts"],
      [["C:/a.test.ts"], "C:/a.test.ts"],
      [["-secret.test.ts"], "-secret.test.ts"],
      [["a.test.ts\n"], "a.test.ts\n"],
      [["a\0b.test.ts"], "a\0b.test.ts"],
      [["a.test.ts "], "a.test.ts "],
      [["vitest", "run", "-t", "-bad", "a.test.ts"], "-bad"],
      [["vitest", "run", "-t", "one", "--testNamePattern", "two", "a.test.ts"], "--testNamePattern"],
      [["a.test.ts", "-t"], "-t"],
      [["vitest", "run", "--testNamePattern="], "--testNamePattern="],
      [["vitest", "run", "-t", "a".repeat(257), "a.test.ts"], "a".repeat(257)],
      [["$(id)"], "$(id)"],
      [["`id`"], "`id`"],
      [["\uFF0D\uFF0Dconfig"], "\uFF0D\uFF0Dconfig"],
      [["a test.ts"], "a test.ts"],
      [['a"b.test.ts'], 'a"b.test.ts'],
      [["a//b.test.ts"], "a//b.test.ts"],
      [["a\\b.test.ts"], "a\\b.test.ts"],
      [["a".repeat(257) + ".ts"], "a".repeat(257) + ".ts"],
    ];
    for (const [argv, token] of cases) expectRejected(argv, token);
    expect(() => validateArtifactArgv([])).toThrow(/file list is empty/);
    expect(() => validateArtifactArgv(["vitest", "run"])).toThrow(/file list is empty/);
    expect(() => validateArtifactArgv(["vitest", "run", "-t", "name"])).toThrow(/file list is empty/);
  });
});

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numTotalTests: 2,
    numPassedTests: 2,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults: [{
      name: "C:/secret/proj/src/a.test.ts",
      status: "passed",
      assertionResults: [
        { ancestorTitles: [], fullName: "adds two", title: "adds two", status: "passed" },
        { ancestorTitles: ["math"], fullName: "math subtracts", title: "subtracts", status: "passed" },
      ],
    }],
    ...over,
  };
}

describe("judgeVitestReport", () => {
  const required = [
    { file: "src/a.test.ts", fullName: "adds two" },
    { file: "src/a.test.ts", fullName: "math subtracts" },
  ];

  it("passes only when every required test passed and at least one test ran", () => {
    expect(judgeVitestReport(report(), required)).toEqual({ verdict: "PASS", reasons: [] });
    const skipped = report();
    const results = skipped.testResults as { assertionResults: { status: string }[] }[];
    results[0]!.assertionResults[1]!.status = "skipped";
    const judged = judgeVitestReport(skipped, required);
    expect(judged.verdict).toBe("FAIL");
    expect(judged.reasons).toContain('Required test src/a.test.ts "math subtracts" is skipped, not passed.');
    expect(judged.reasons.join("\n")).not.toContain("C:/secret");
    expect(judgeVitestReport(report(), [{ file: "src/a.test.ts", fullName: "adds two" }])).toEqual({ verdict: "PASS", reasons: [] });
    expect(judgeVitestReport(report({ numPassedTests: 0, numFailedTests: 0, success: true, testResults: [] }), required).reasons).toContain("Vitest report ran no tests.");
    expect(judgeVitestReport(report(), []).reasons).toContain("Required test list is empty.");
    expect(judgeVitestReport(report({ success: false, numFailedTests: 1 }), required).reasons).toEqual(expect.arrayContaining([
      "Vitest report success is not true.",
      "Vitest report has failed tests.",
    ]));
    const pending = report();
    (pending.testResults as { assertionResults: { status: string }[] }[])[0]!.assertionResults[0]!.status = "pending";
    expect(judgeVitestReport(pending, [required[0]!]).reasons[0]).toMatch(/pending, not passed/);
    const todo = report();
    (todo.testResults as { assertionResults: { status: string }[] }[])[0]!.assertionResults[0]!.status = "todo";
    expect(judgeVitestReport(todo, [required[0]!]).reasons[0]).toMatch(/todo, not passed/);
    expect(judgeVitestReport(report(), [{ file: "src/missing.test.ts", fullName: "adds two" }]).reasons[0]).toMatch(/is missing/);
    expect(judgeVitestReport({ success: true }, required)).toEqual({ verdict: "FAIL", reasons: ["Vitest report is not a JSON reporter object."] });
    expect(judgeVitestReport(null, required).verdict).toBe("FAIL");
    const sibling = report({
      testResults: [{
        name: "C:/secret/proj/foo-src/a.test.ts",
        status: "passed",
        assertionResults: [{ ancestorTitles: [], fullName: "adds two", title: "adds two", status: "passed" }],
      }],
    });
    expect(judgeVitestReport(sibling, [{ file: "src/a.test.ts", fullName: "adds two" }]).reasons[0]).toMatch(/is missing/);
    expect(judgeVitestReport(report({ extra: true }), required).verdict).toBe("PASS");
  });
});

describe("real vitest json reports", () => {
  it("judges reports produced by the repo vitest, without loading the repo config", () => {
    const pkgPath = join(REPO, "node_modules", "vitest", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string; bin: { vitest: string } };
    expect(pkg.version).toBe("4.1.11");
    const vitestBin = join(REPO, "node_modules", "vitest", pkg.bin.vitest);
    const root = mkdtempSync(join(tmpdir(), "ludion-vitest-judge-"));
    const run = (file: string, outName: string, extra: string[] = []) => {
      const out = join(root, outName);
      const result = spawnSync(process.execPath, [
        vitestBin, "run",
        `--config=${RUNNER_CONFIG}`,
        `--root=${root}`,
        "--reporter=json",
        `--outputFile=${out}`,
        ...extra,
        file,
      ], { cwd: root, encoding: "utf8", timeout: 60_000 });
      const body = JSON.parse(readFileSync(out, "utf8")) as {
        numTotalTests: number;
        numPassedTests: number;
        numFailedTests: number;
        success: boolean;
        testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[];
      };
      return { status: result.status, body };
    };
    try {
      symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
      writeFileSync(join(root, "math.test.ts"), [
        'import { expect, test } from "vitest";',
        'test("adds two", () => { expect(1 + 1).toBe(2); });',
        'test("subtracts", () => { expect(2 - 1).toBe(1); });',
        "",
      ].join("\n"));
      const all = run("math.test.ts", "all.json");
      expect(all.status).toBe(0);
      expect(all.body.numTotalTests).toBe(2);
      expect(all.body.numPassedTests).toBe(2);
      expect(judgeVitestReport(all.body, [
        { file: "math.test.ts", fullName: "adds two" },
        { file: "math.test.ts", fullName: "subtracts" },
      ])).toEqual({ verdict: "PASS", reasons: [] });
      expect(judgeVitestReport(all.body, []).verdict).toBe("FAIL");

      const subset = run("math.test.ts", "subset.json", ["--testNamePattern=adds"]);
      expect(subset.status).toBe(0);
      expect(subset.body.numTotalTests).toBe(2);
      const statuses = subset.body.testResults[0]?.assertionResults ?? [];
      expect(statuses.find((item) => item.fullName === "adds two")?.status).toBe("passed");
      expect(statuses.find((item) => item.fullName === "subtracts")?.status).toBe("skipped");
      expect(judgeVitestReport(subset.body, [{ file: "math.test.ts", fullName: "adds two" }])).toEqual({ verdict: "PASS", reasons: [] });
      expect(judgeVitestReport(subset.body, [{ file: "math.test.ts", fullName: "subtracts" }]).verdict).toBe("FAIL");

      const none = run("math.test.ts", "none.json", ["--testNamePattern=zzz-no-such"]);
      expect(none.body.numPassedTests + none.body.numFailedTests).toBe(0);
      expect(none.body.numTotalTests).toBeLessThan(10);
      const noneJudged = judgeVitestReport(none.body, [{ file: "math.test.ts", fullName: "adds two" }]);
      expect(noneJudged.verdict).toBe("FAIL");
      expect(noneJudged.reasons).toContain("Vitest report ran no tests.");

      writeFileSync(join(root, "math.test.ts"), [
        'import { expect, test } from "vitest";',
        'test("adds two", () => { expect(1 + 1).toBe(3); });',
        'test("subtracts", () => { expect(2 - 1).toBe(1); });',
        "",
      ].join("\n"));
      const failed = run("math.test.ts", "fail.json");
      expect(failed.status).not.toBe(0);
      expect(failed.body.numFailedTests).toBeGreaterThan(0);
      expect(failed.body.numTotalTests).toBe(2);
      expect(judgeVitestReport(failed.body, [{ file: "math.test.ts", fullName: "adds two" }]).verdict).toBe("FAIL");
    } finally {
      rmSync(join(root, "node_modules"), { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
});
