// Maven is out of what Ludion fixes, and its read-only scan stays (the owner, 2026-11-01,
// docs/decisions/2026-11-01-definition-of-complete.md): whatever would fix refuses it and says why, before any Docker,
// OSV or registry work. No test here reaches Docker or the network.
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkProject } from "../src/security/check.ts";
import { securityCli } from "../src/security/cli.ts";
import { checkArtifact } from "../src/security/deliver.ts";
import { patchDependencies } from "../src/security/dependency-patch.ts";
import type { DependencyScan, OsvClient } from "../src/security/osv.ts";
import { CONFIG, MAVEN_REFUSAL, readConfig } from "../src/security/project.ts";
import { commit } from "./git.ts";

const POM = "<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>app</artifactId><version>1.0</version></project>\n";
/** A model the Maven scan stops at (dependency-patch.ts, acquisitionPolicy), before it starts Docker. */
const POM_WITH_MODULES = POM.replace("</project>", "<modules><module>a</module></modules></project>");
const STOPPED = "Maven modules must be registered individually.";
const MAVEN_POLICY = JSON.stringify({ schema: 1, ecosystem: "maven", image: "maven:3.9-eclipse-temurin-21", test: ["mvn", "verify"], timeout_seconds: 120 });
const NPM_POLICY = JSON.stringify({ schema: 1, ecosystem: "npm", test: ["npm", "test"], timeout_seconds: 120 });

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "ludion-maven-"));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return root;
}
const noCalls = () => {
  const scan = vi.fn(async () => ({ findings: [] }) as unknown as DependencyScan);
  const command = vi.fn(async () => { throw new Error("Docker was started."); });
  return { scan, command, deps: { client: { scan } as unknown as OsvClient, command: command as never } };
};

afterEach(() => vi.restoreAllMocks());

describe("what would fix refuses Maven, and says why", () => {
  it("the refusal says that Maven is out, and that the scan stays", () => {
    expect(MAVEN_REFUSAL).toContain("outside what Ludion fixes");
    expect(MAVEN_REFUSAL).toContain("ludion scan still reports its known advisories");
  });
  it.each([[false], [true]])("patch on a saved Maven policy starts nothing and writes nothing (apply: %s)", async apply => {
    const root = project({ [CONFIG]: MAVEN_POLICY, "pom.xml": POM });
    const { scan, command, deps } = noCalls();
    await expect(patchDependencies(root, apply, deps)).rejects.toThrow(MAVEN_REFUSAL);
    expect(scan).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(readdirSync(root).sort()).toEqual([CONFIG, "pom.xml"].sort());
  });
  it("the refusal is Maven's alone: an npm policy goes on to its advisory lookup", async () => {
    const root = project({ [CONFIG]: NPM_POLICY, "package.json": "{\"name\":\"app\"}\n", "package-lock.json": "{\"name\":\"app\",\"lockfileVersion\":3,\"packages\":{\"\":{\"name\":\"app\"}}}\n" });
    const { scan, deps } = noCalls();
    await expect(patchDependencies(root, false, deps)).resolves.toMatchObject({ receipt: null });
    expect(scan).toHaveBeenCalledOnce();
  });
  it.each([["patch", []], ["patch", ["--apply"]], ["patch", ["--json"]]] as const)("ludion %s %j on a saved Maven policy refuses", async (command, flags) => {
    await expect(securityCli(command, ["--dir", project({ [CONFIG]: MAVEN_POLICY, "pom.xml": POM }), ...flags])).rejects.toThrow(MAVEN_REFUSAL);
  });
  it("ludion watch stops at the refusal, instead of printing it every round for good", async () => {
    await expect(securityCli("watch", ["--dir", project({ [CONFIG]: MAVEN_POLICY, "pom.xml": POM }), "--interval", "60"])).rejects.toThrow(MAVEN_REFUSAL);
  });
  it.each(["init", "patch", "watch"])("%s --ecosystem maven refuses with the reason, and writes no policy", async command => {
    const root = project({ "pom.xml": POM });
    await expect(securityCli(command, ["--dir", root, "--ecosystem", "maven"])).rejects.toThrow(MAVEN_REFUSAL);
    expect(existsSync(join(root, CONFIG))).toBe(false);
  });
  it.each([[[]], [["--ecosystem", "auto"]]])("init %j on a project with only a pom.xml refuses, and writes no policy", async flags => {
    const root = project({ "pom.xml": POM });
    await expect(securityCli("init", ["--dir", root, ...flags])).rejects.toThrow(MAVEN_REFUSAL);
    expect(existsSync(join(root, CONFIG))).toBe(false);
  });
  it("init beside a pom.xml still makes the policy of a fixable ecosystem, when asked for it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const root = project({ "pom.xml": POM, "package-lock.json": "{}" });
    await expect(securityCli("init", ["--dir", root])).rejects.toThrow("--ecosystem php|node|npm|composer.");
    expect(await securityCli("init", ["--dir", root, "--ecosystem", "npm"])).toBe(0);
    expect(readConfig(root)).toMatchObject({ ecosystem: "npm" });
  });
  it("the scheduled workflow: the check says patch will refuse, and patch's job fails with the reason", async () => {
    const answer = await checkProject(project({ [CONFIG]: MAVEN_POLICY, "pom.xml": POM }), { fetchFn: (async () => { throw new Error("no network"); }) as typeof fetch });
    expect(answer).toMatchObject({ decided: false, ecosystem: "maven", reason: expect.stringContaining("which patch refuses") });
  });
  it("the PR job refuses an artifact when the base commit's policy names maven, whatever it holds", () => {
    const work = project({ [CONFIG]: MAVEN_POLICY, "pom.xml": POM });
    const base = commit(work);
    const out = mkdtempSync(join(tmpdir(), "ludion-maven-artifact-"));
    writeFileSync(join(out, "receipt.json"), "null\n");
    expect(() => checkArtifact(work, out, base)).toThrow(MAVEN_REFUSAL);
  });
});

describe("the read-only scan stays", () => {
  it("a saved Maven policy is still read, since scan takes its tool image from it", () => {
    expect(readConfig(project({ [CONFIG]: MAVEN_POLICY }))).toMatchObject({ ecosystem: "maven", image: "maven:3.9-eclipse-temurin-21" });
  });
  it.each([
    ["--ecosystem maven, no policy", {}, ["--ecosystem", "maven"]],
    ["--ecosystem maven, a saved Maven policy", { [CONFIG]: MAVEN_POLICY }, ["--ecosystem", "maven"]],
    ["unselected, no policy", {}, []],
    ["unselected, a saved Maven policy", { [CONFIG]: MAVEN_POLICY }, []],
  ] as [string, Record<string, string>, string[]][])("scan reaches the Maven check: %s", async (_, files, flags) => {
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => { errors.push(line); });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await securityCli("scan", ["--dir", project({ "pom.xml": POM_WITH_MODULES, ...files }), ...flags])).toBe(2);
    expect(errors).toEqual([`maven: unavailable — ${STOPPED}`]);
  });
});

describe("the READMEs say what patch does", () => {
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
  it.each(["README.md", "packages/cli/README.md"])("%s: Maven's row is read-only, and no sentence has patch fix it", path => {
    const text = read(path);
    expect(text).toMatch(/^\| Java \/ Maven \| [^|]+\| None: read-only scan\./m);
    // The sentences that named Maven among what is fixed, in the forms they had.
    for (const stale of [/supports five ecosystems/, /npm, Composer and Maven the top-level/, /Composer and Maven candidates/, /Composer and Maven use ecosystem/, /composer\.lock, pom\.xml/, /Maven's transitive graph/, /Maven uses explicit versions/, /always for Maven/]) expect(text).not.toMatch(stale);
  });
});
