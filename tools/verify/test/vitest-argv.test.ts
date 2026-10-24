import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVerifierVitestArgv, validateArtifactArgv, type VerifierVitestContext } from "../src/vitest-argv.ts";

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

describe("buildVerifierVitestArgv", () => {
  it("puts the runner's vitest, fixed flags, config, filter, and files in that order", () => {
    withTemp((parent) => {
      const recipient = join(parent, "recipient");
      const verifier = join(parent, "verifier");
      const deps = join(parent, "deps");
      mkdirSync(recipient);
      mkdirSync(verifier);
      mkdirSync(deps);
      const configPath = join(verifier, "vitest.config.ts");
      const vitestPath = join(deps, "vitest.mjs");
      writeFileSync(configPath, "export default {}\n");
      writeFileSync(vitestPath, "#!/usr/bin/env node\n");
      const ctx: VerifierVitestContext = { recipientRoot: recipient, verifierRoot: verifier, vitestPath, configPath };
      const argv = buildVerifierVitestArgv({ files: ["src/a.test.ts", "src/b.test.ts"], testNamePattern: "adds two" }, ctx);
      expect(argv).toEqual([
        vitestPath,
        "run",
        "--allowOnly=false",
        "--config",
        configPath,
        "-t",
        "adds two",
        "src/a.test.ts",
        "src/b.test.ts",
      ]);
      expect(argv).not.toContain("--passWithNoTests");
      expect(argv).not.toContain("--watch");
      expect(argv).not.toContain("--update");
      expect(argv).not.toContain("--allowOnly");
      const plain = buildVerifierVitestArgv({ files: ["a.test.ts"] }, { recipientRoot: recipient, verifierRoot: verifier, vitestPath });
      expect(plain).toEqual([vitestPath, "run", "--allowOnly=false", "a.test.ts"]);
    });
  });

  it("rejects a vitest or config path inside the recipient, and a config outside the verifier", () => {
    withTemp((parent) => {
      const recipient = join(parent, "recipient");
      const verifier = join(parent, "verifier");
      const nested = join(recipient, ".verifier");
      const deps = join(parent, "deps");
      mkdirSync(verifier);
      mkdirSync(nested, { recursive: true });
      mkdirSync(deps);
      const vitestPath = join(deps, "vitest.mjs");
      const insideVitest = join(recipient, "node_modules", "vitest", "vitest.mjs");
      const configPath = join(verifier, "vitest.config.ts");
      const nestedConfig = join(nested, "vitest.config.ts");
      const outsideConfig = join(parent, "other.config.ts");
      mkdirSync(join(recipient, "node_modules", "vitest"), { recursive: true });
      writeFileSync(vitestPath, "");
      writeFileSync(insideVitest, "");
      writeFileSync(configPath, "");
      writeFileSync(nestedConfig, "");
      writeFileSync(outsideConfig, "");
      const ctx = { recipientRoot: recipient, verifierRoot: verifier, vitestPath, configPath };
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, vitestPath: insideVitest })).toThrow(/vitestPath must not be inside the recipient/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, verifierRoot: nested, configPath: nestedConfig })).toThrow(/configPath must not be inside the recipient/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, configPath: outsideConfig })).toThrow(/configPath must be inside the verifier root/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], configPath } as { files: string[] }, ctx)).toThrow(/Unknown request field configPath/);
      expect(() => buildVerifierVitestArgv({ files: [] }, ctx)).toThrow(/non-empty/);
      expect(() => buildVerifierVitestArgv({ files: ["../a.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["-secret.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["C:/a.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["/tmp/a.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["a\nb.test.ts"] }, ctx)).toThrow(/Invalid test file/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "-evil" }, ctx)).toThrow(/Invalid testNamePattern/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "" }, ctx)).toThrow(/Invalid testNamePattern/);
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "a".repeat(201) }, ctx)).toThrow(/Invalid testNamePattern/);
      expect(buildVerifierVitestArgv({ files: ["a.test.ts"], testNamePattern: "a".repeat(200) }, ctx)).toContain("-t");
      expect(() => buildVerifierVitestArgv({ files: ["a.test.ts"] }, { ...ctx, configPath: "vitest.config.ts" })).toThrow(/configPath must be an absolute path/);
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
    const long = "n".repeat(200);
    expect(validateArtifactArgv(["a.test.ts", "-t", long]).testNamePattern).toBe(long);
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
      [["vitest", "run", "-t", "a".repeat(201), "a.test.ts"], "a".repeat(201)],
    ];
    for (const [argv, token] of cases) expectRejected(argv, token);
    expect(() => validateArtifactArgv([])).toThrow(/file list is empty/);
    expect(() => validateArtifactArgv(["vitest", "run"])).toThrow(/file list is empty/);
    expect(() => validateArtifactArgv(["vitest", "run", "-t", "name"])).toThrow(/file list is empty/);
  });
});
