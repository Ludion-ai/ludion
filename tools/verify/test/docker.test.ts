import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertInstallWorkDirClean,
  buildDockerRunArgs,
  buildRequirementsTxt,
  checkNpmLockfile,
  dockerArgs,
  dockerMountSource,
  ensureViteScratchDirs,
  imageFor,
  IMAGE_DIGESTS,
  installArgs,
  prepareSandboxWorkDir,
  resolveSandboxUser,
  runInDocker,
  sandboxUserIsFallback,
  type DockerRunOptions,
  type InstallStep,
} from "../src/docker.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const DOCKER_TS = fileURLToPath(new URL("../src/docker.ts", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../../lessons/lessons.schema.json", import.meta.url));
const REPO = fileURLToPath(new URL("../../..", import.meta.url));

/** Env copied into the test so a rename in docker.ts fails here. Docker does not forward host env by default. */
const NPM_INSTALL_ENV = [
  "HOME=/w/.home",
  "npm_config_cache=/w/.npm",
  "npm_config_userconfig=/w/.npmrc",
  "npm_config_globalconfig=/w/.npmrc-global",
];
const PIP_INSTALL_ENV = ["HOME=/w/.home", "PIP_CONFIG_FILE=/w/pip.conf"];
const RUN_ENV = ["HOME=/tmp", "NODE_PATH=/w/node_modules", "PYTHONPATH=/w/site", "LUDION_PACKAGES=/w"];
const SECRET_ENV = /TOKEN|SECRET|AUTH|PASSWORD|KEY|NPM_TOKEN|GITHUB/i;

const PIN = /@sha256:[a-f0-9]{64}$/;
const USER = /^[1-9][0-9]*:[1-9][0-9]*$/;

function valueAfter(args: readonly string[], flag: string): string {
  const at = args.indexOf(flag);
  expect(at, flag).toBeGreaterThanOrEqual(0);
  expect(args.lastIndexOf(flag), `${flag} once`).toBe(at);
  const value = args[at + 1];
  expect(value, `${flag} value`).toBeDefined();
  expect(value!.startsWith("-"), `${flag} value`).toBe(false);
  return value!;
}

function valuesAfter(args: readonly string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[i + 1] ?? "");
  return out;
}

function mounts(args: readonly string[]): string[] {
  return valuesAfter(args, "-v");
}

/** Bind destination. dockerMountSource strips every colon from the host path. */
function mountDestination(spec: string): string {
  const colon = spec.indexOf(":");
  const rest = colon === -1 ? spec : spec.slice(colon + 1);
  if (rest.endsWith(":ro") || rest.endsWith(":rw")) return rest.slice(0, -3);
  return rest;
}

const TMP_TMPFS = "/tmp:rw,noexec,nosuid,nodev,size=64m";
const RUN_WORK_TMPFS = "/w:rw,noexec,nosuid,nodev,size=128m,mode=1777";
const VITE_SCRATCH_TMPFS = {
  ".vite-temp": "/w/node_modules/.vite-temp:rw,noexec,nosuid,nodev,size=32m,mode=1777",
  ".vite": "/w/node_modules/.vite:rw,noexec,nosuid,nodev,size=32m,mode=1777",
} as const;

function linkDir(target: string, path: string): void {
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
}

/** Vite tmpfs flags sit immediately after the read-only node_modules bind, in this order. */
function expectViteScratchTmpfs(args: readonly string[], names: readonly (keyof typeof VITE_SCRATCH_TMPFS)[]): void {
  const roAt = args.findIndex((arg) => arg.endsWith(":/w/node_modules:ro"));
  expect(roAt).toBeGreaterThan(0);
  expect(args[roAt - 1]).toBe("-v");
  let cursor = roAt + 1;
  for (const name of names) {
    expect(args[cursor], name).toBe("--tmpfs");
    expect(args[cursor + 1], name).toBe(VITE_SCRATCH_TMPFS[name]);
    cursor += 2;
  }
  const vite = valuesAfter(args, "--tmpfs").filter((flag) => flag.startsWith("/w/node_modules/"));
  expect(vite).toEqual(names.map((name) => VITE_SCRATCH_TMPFS[name]));
  for (const spec of mounts(args)) {
    expect(spec.endsWith(":ro"), spec).toBe(true);
    expect(spec, spec).not.toContain(".vite");
  }
}

/** Run phase: /w is a tmpfs, and every bind is read-only and not the whole work directory. */
function expectRunMounts(args: readonly string[]): void {
  for (const spec of mounts(args)) {
    expect(spec.endsWith(":ro"), spec).toBe(true);
    expect(mountDestination(spec), spec).not.toBe("/w");
    expect(spec, spec).not.toMatch(/:\/w(?::rw)?$/);
  }
}

function expectHardened(args: readonly string[], phase: "run" | "install"): void {
  expect(args[0]).toBe("run");
  expect(valueAfter(args, "--cap-drop")).toBe("ALL");
  expect(valueAfter(args, "--security-opt")).toBe("no-new-privileges");
  expect(args.filter((arg) => arg === "--read-only")).toEqual(["--read-only"]);
  expect(valueAfter(args, "--memory")).toBe("512m");
  expect(valueAfter(args, "--cpus")).toBe("1");
  expect(valueAfter(args, "--pids-limit")).toBe("256");
  const user = valueAfter(args, "--user");
  expect(user).toMatch(USER);
  expect(user).not.toBe("0:0");
  expect(user.split(":")).not.toContain("0");
  if (phase === "run") {
    expect(valueAfter(args, "--network")).toBe("none");
    expect(args).toContain("-i");
  } else {
    expect(args).not.toContain("--network");
    expect(args).not.toContain("none");
    expect(args).not.toContain("-i");
  }
  const tmpfs = valuesAfter(args, "--tmpfs");
  expect(tmpfs[0]).toBe(TMP_TMPFS);
  expect(tmpfs[0]).toContain("noexec,nosuid");
  expect(tmpfs.filter((value) => value.startsWith("/tmp:"))).toEqual([TMP_TMPFS]);
  const scratch = tmpfs.filter((value) => value !== TMP_TMPFS);
  if (phase === "install") {
    expect(scratch).toEqual([]);
  } else if (valuesAfter(args, "-w").includes("/w")) {
    expect(scratch).toEqual([RUN_WORK_TMPFS]);
    expectRunMounts(args);
  } else {
    expect(scratch).toEqual([]);
    expectRunMounts(args);
  }
  const image = args.find((arg) => PIN.test(arg));
  expect(image).toBeDefined();
  const tag = image!.slice(0, image!.indexOf("@"));
  expect(IMAGE_DIGESTS).toHaveProperty(tag);
  expect(image).toBe(`${tag}@${IMAGE_DIGESTS[tag as keyof typeof IMAGE_DIGESTS]}`);
  const imageAt = args.indexOf(image!);
  expect(imageAt).toBeGreaterThan(args.indexOf("--cap-drop"));
  expect(imageAt).toBeGreaterThan(args.indexOf("--user"));
  expect(imageAt).toBeGreaterThan(args.indexOf("--tmpfs"));
}

function hostIds(): { uid: number | undefined; gid: number | undefined } {
  return {
    uid: typeof process.getuid === "function" ? process.getuid() : undefined,
    gid: typeof process.getgid === "function" ? process.getgid() : undefined,
  };
}

function runtimeEnum(schema: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const record = node as Record<string, unknown>;
    const runtime = record.runtime;
    if (runtime && typeof runtime === "object" && !Array.isArray(runtime)) {
      const values = (runtime as Record<string, unknown>).enum;
      if (Array.isArray(values) && values.every((item) => typeof item === "string" && /^(?:node|python)@\d/.test(item))) {
        found.push(...(values as string[]));
      }
    }
    for (const value of Object.values(record)) visit(value);
  };
  visit(schema);
  return found;
}

function withWork(fn: (work: string) => void): void {
  const work = mkdtempSync(join(tmpdir(), "ludion-docker-"));
  try {
    fn(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Leave `work` holding only the files that install step is allowed to see. */
function seedInstall(work: string, step: InstallStep): void {
  for (const name of readdirSync(work)) rmSync(join(work, name), { recursive: true, force: true });
  if (step === "pip") {
    writeFileSync(join(work, "requirements.txt"), `requests==2.32.0 --hash=sha256:${"ab".repeat(32)}\n`);
    return;
  }
  writeFileSync(join(work, "package.json"), "{\"private\":true}\n");
  if (step === "npm-ci") {
    writeFileSync(join(work, "package-lock.json"), "{}\n");
    mkdirSync(join(work, ".home"));
    mkdirSync(join(work, ".npm"));
  }
}

function envPairs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "-e") out.push(args[i + 1] ?? "");
  return out;
}

function workMount(args: readonly string[]): string {
  const found = mounts(args).find((mount) => mount.includes(":/w"));
  expect(found).toBeDefined();
  return found!;
}

describe("docker run hardening", () => {
  it("puts every hardening flag on both phases, with and without a work directory", () => {
    withWork((work) => {
      const cases: { phase: "run" | "install"; opts: DockerRunOptions }[] = [
        { phase: "run", opts: { phase: "run", runtime: "node", name: "n" } },
        { phase: "run", opts: { phase: "run", runtime: "python@3.12", name: "ludion-verify-1", workDir: work } },
        { phase: "install", opts: { phase: "install", runtime: "node@24", name: "ludion-install-1", installStep: "npm-lock" } },
        { phase: "install", opts: { phase: "install", runtime: "python@3.14", name: "ludion-install-2", workDir: work, packages: { requests: "2.32.0" }, installStep: "pip" } },
      ];
      for (const { phase, opts } of cases) {
        if (opts.phase === "install" && opts.workDir !== undefined && opts.installStep !== undefined) seedInstall(opts.workDir, opts.installStep);
        const args = buildDockerRunArgs(opts);
        expectHardened(args, phase);
        if (opts.workDir === undefined) {
          expect(args).not.toContain("-v");
          expect(valuesAfter(args, "--tmpfs")).toEqual([TMP_TMPFS]);
        } else if (phase === "run") {
          expect(valuesAfter(args, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);
          expect(mounts(args)).toEqual([]);
          expect(valueAfter(args, "-w")).toBe("/w");
          expectRunMounts(args);
        } else {
          expect(workMount(args)).toMatch(/:\/w$/);
          expect(workMount(args)).not.toMatch(/:ro$/);
        }
      }
    });
  });

  it("keeps the network on the phase: run is always none, install never sets it", () => {
    withWork((work) => {
      const run = dockerArgs("node@24", "n", work);
      const bare = dockerArgs("bash", "n");
      seedInstall(work, "npm-lock");
      const npm = installArgs("node@24", work, { vitest: "5.0.3" }, "npm-lock", "ludion-install-npm");
      expect(npm).toEqual(buildDockerRunArgs({ phase: "install", runtime: "node@24", name: "ludion-install-npm", workDir: work, packages: { vitest: "5.0.3" }, installStep: "npm-lock" }));
      seedInstall(work, "pip");
      const pip = installArgs("python@3.12", work, { requests: "2.32.0" }, "pip", "ludion-install-pip");
      expect(valueAfter(run, "--network")).toBe("none");
      expect(valueAfter(bare, "--network")).toBe("none");
      expect(npm).not.toContain("--network");
      expect(pip).not.toContain("--network");
      expect(dockerArgs("node", "n")).toEqual(buildDockerRunArgs({ phase: "run", runtime: "node", name: "n" }));
      expect(dockerArgs("node@24", "n", work)).toEqual(buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work }));
      expect(run.join("\n")).not.toBe(npm.join("\n"));
    });
  });

  it("runs no lesson code in the install phase and disables scripts in every step", () => {
    withWork((work) => {
      seedInstall(work, "npm-lock");
      const lock = installArgs("node@24", work, { vitest: "5.0.3" }, "npm-lock", "ludion-install-npm");
      seedInstall(work, "npm-ci");
      const ci = installArgs("node@24", work, { vitest: "5.0.3" }, "npm-ci", "ludion-install-ci");
      seedInstall(work, "pip");
      const pip = installArgs("python@3.12", work, { requests: "2.32.0" }, "pip", "ludion-install-pip");
      const npmImage = imageFor("node@24")!.image;
      const pipImage = imageFor("python@3.12")!.image;
      expect(lock.slice(lock.indexOf(npmImage) + 1)).toEqual([
        "npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error",
      ]);
      expect(ci.slice(ci.indexOf(npmImage) + 1)).toEqual([
        "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error",
      ]);
      expect(pip.slice(pip.indexOf(pipImage) + 1)).toEqual([
        "pip", "install", "--require-hashes", "--only-binary", ":all:", "--no-cache-dir", "--target", "/w/site", "-r", "/w/requirements.txt",
      ]);
      for (const args of [lock, ci]) expect(args).toContain("--ignore-scripts");
      expect(pip).toContain("--only-binary");
      expect(pip).toContain("--require-hashes");
      expect(lock).not.toContain("-");
      expect(lock).not.toContain("vitest");
      expect(ci).not.toContain("vitest");
      expect(pip).not.toContain("-");
      expect(pip).not.toContain("requests");
      expect(pip).not.toContain("requests==2.32.0");
    });
    const withCode = {
      phase: "install" as const,
      runtime: "node@24",
      name: "ludion-install-npm",
      packages: { vitest: "5.0.3" },
      installStep: "npm-lock" as const,
      code: "process.exit(0)",
    };
    expect(() => buildDockerRunArgs(withCode)).toThrow(/Unknown docker option code/);
    expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", packages: { vitest: "5.0.3" } })).toThrow(/run phase does not take packages/);
    expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", installStep: "npm-ci" })).toThrow(/run phase does not take installStep/);
    expect(() => buildDockerRunArgs({ phase: "install", runtime: "node@24", name: "n", installStep: "yarn" as InstallStep })).toThrow(/Unknown install step/);
  });

  it("rejects caller attempts to override the sandbox", () => {
    const poisoned = {
      phase: "run" as const,
      runtime: "node",
      name: "n",
      network: "host",
      user: "0:0",
      capDrop: "ALL",
      readOnly: false,
      extra: ["--privileged", "--cap-add", "SYS_ADMIN", "--network", "host"],
    };
    expect(() => buildDockerRunArgs(poisoned)).toThrow(/Unknown docker option network/);
    expect(() => {
      // @ts-expect-error network is not a docker option, so a caller cannot type it
      buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", network: "host" });
    }).toThrow(/Unknown docker option network/);
    expect(() => dockerArgs("node", "bad name")).toThrow(/Container name/);
    expect(() => dockerArgs("node", "n", "/tmp/w,exec")).toThrow(/Work directory/);
    expect(() => dockerArgs("node", "n", "/tmp/w:ro")).toThrow(/Work directory/);
    expect(() => dockerArgs("node", "n", "/tmp/../etc")).toThrow(/Work directory/);
    expect(() => dockerArgs("node", "n", "relative/w")).toThrow(/Work directory/);
    expect(() => dockerArgs("node", "n", "C:\\work\\lesson:/etc")).toThrow(/Work directory/);
    expect(() => installArgs("python@3.12", "/tmp/w", { "requests;x": "2.32.0" }, "pip", "ludion-install-pip")).toThrow(/Package/);
    expect(() => installArgs("python@3.12", "/tmp/w", { requests: "2.32.0\n--index-url=http://evil" }, "pip", "ludion-install-pip")).toThrow(/Package/);
    expect(() => installArgs("node@24", "/tmp/w", { "--unsafe-perm": "1.2.3" }, "npm-lock", "ludion-install-npm")).toThrow(/Package/);
    expect(() => buildDockerRunArgs({ phase: "host" as "run", runtime: "node", name: "n" })).toThrow(/Unknown docker phase/);
    // A rejected call returns nothing, so it cannot be a weaker docker run.
    withWork((work) => {
      const safe = dockerArgs("node", "still-safe", work);
      expectHardened(safe, "run");
      expect(valueAfter(safe, "--network")).toBe("none");
      expect(valueAfter(safe, "--user")).not.toBe("0:0");
      expect(valuesAfter(safe, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);
      expect(mounts(safe).some((spec) => mountDestination(spec) === "/w")).toBe(false);
      expectRunMounts(safe);
    });
  });

  it("uses a non-root numeric uid:gid, and the host uid only when it is non-zero", () => {
    expect(resolveSandboxUser(0, 0)).toBe("1000:1000");
    expect(resolveSandboxUser(0, 1000)).toBe("1000:1000");
    expect(resolveSandboxUser(1000, 0)).toBe("1000:1000");
    expect(resolveSandboxUser(undefined, undefined)).toBe("1000:1000");
    expect(resolveSandboxUser(1.5, 1000)).toBe("1000:1000");
    expect(resolveSandboxUser(-1, 20)).toBe("1000:1000");
    expect(resolveSandboxUser(501, 20)).toBe("501:20");
    const { uid, gid } = hostIds();
    const expected = resolveSandboxUser(uid, gid);
    expect(valueAfter(dockerArgs("node", "n"), "--user")).toBe(expected);
    withWork((work) => {
      seedInstall(work, "npm-lock");
      expect(valueAfter(installArgs("node", work, { vitest: "5.0.3" }, "npm-lock", "ludion-install-npm"), "--user")).toBe(expected);
    });
    expect(expected).toMatch(USER);
    const hostUsable = typeof uid === "number" && typeof gid === "number" && uid > 0 && gid > 0;
    expect(sandboxUserIsFallback()).toBe(!hostUsable);
  });

  it("rewrites a real temp directory into a mount source with no colon or comma", () => {
    withWork((work) => {
      mkdirSync(join(work, "node_modules"));
      const source = dockerMountSource(work);
      const nmSource = dockerMountSource(join(work, "node_modules"));
      expect(source.startsWith("/")).toBe(true);
      expect(source).not.toContain(":");
      expect(source).not.toContain(",");
      expect(source).not.toContain("\\");
      expect(source).not.toContain("..");
      expect(nmSource).not.toContain(":");
      expect(nmSource).not.toContain(",");
      expect(nmSource).not.toContain("\\");
      if (process.platform === "win32") expect(nmSource.startsWith(`/${work.slice(0, 1).toLowerCase()}/`)).toBe(true);
      const args = dockerArgs("node", "n", work);
      expect(mounts(args)).toEqual([`${nmSource}:/w/node_modules:ro`]);
      expect(args).not.toContain(`${source}:/w`);
      expect(args).not.toContain(`${source}:/w:ro`);
      expect(args).not.toContain(`${source}:/w:rw`);
      expectRunMounts(args);
    });
  });

  it("mounts install results read-only under a tmpfs /w and never the work directory", () => {
    withWork((work) => {
      const bare = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n" });
      expect(valuesAfter(bare, "--tmpfs")).toEqual([TMP_TMPFS]);
      expect(bare).not.toContain("-w");
      expect(bare).not.toContain(RUN_WORK_TMPFS);
      expect(envPairs(bare)).toEqual([]);

      const empty = buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work });
      expect(valuesAfter(empty, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);
      expect(mounts(empty)).toEqual([]);
      expect(valueAfter(empty, "-w")).toBe("/w");
      expect(envPairs(empty)).toEqual(RUN_ENV);
      expect(empty).not.toContain(`${dockerMountSource(work)}:/w`);
      expectRunMounts(empty);

      mkdirSync(join(work, "node_modules"));
      mkdirSync(join(work, "site"));
      writeFileSync(join(work, "package.json"), "{}\n");
      const workSource = dockerMountSource(work);
      const nmSource = dockerMountSource(join(work, "node_modules"));
      const siteSource = dockerMountSource(join(work, "site"));
      const node = buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work });
      expect(mounts(node)).toEqual([`${nmSource}:/w/node_modules:ro`]);
      expect(node).not.toContain(`${workSource}:/w`);
      expect(node).not.toContain(`${workSource}:/w:ro`);
      expect(node).not.toContain(`${workSource}:/w:rw`);
      expect(node).not.toContain(`${siteSource}:/w/site:ro`);
      expect(envPairs(node)).toEqual(RUN_ENV);
      expect(valueAfter(node, "-w")).toBe("/w");
      expectRunMounts(node);

      const py = buildDockerRunArgs({ phase: "run", runtime: "python@3.12", name: "n", workDir: work });
      expect(mounts(py)).toEqual([`${siteSource}:/w/site:ro`]);
      expect(py.join(" ")).not.toContain(":/w/node_modules");
      expect(py).not.toContain(`${workSource}:/w`);
      expect(envPairs(py)).toEqual(RUN_ENV);
      expectRunMounts(py);

      rmSync(join(work, "site"), { recursive: true });
      const pyMissing = buildDockerRunArgs({ phase: "run", runtime: "python@3.12", name: "n", workDir: work });
      expect(mounts(pyMissing)).toEqual([]);
      expect(valuesAfter(pyMissing, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);

      rmSync(join(work, "node_modules"), { recursive: true });
      writeFileSync(join(work, "node_modules"), "not a directory\n");
      const fileNm = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work });
      expect(mounts(fileNm)).toEqual([]);
      rmSync(join(work, "node_modules"));

      mkdirSync(join(work, "node_modules"));
      mkdirSync(join(work, "node_modules", ".git"));
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work })).toThrow(/Node modules directory contains \.git/);
      rmSync(join(work, "node_modules"), { recursive: true });

      mkdirSync(join(work, "site"));
      mkdirSync(join(work, "site", ".git"));
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "python@3.12", name: "n", workDir: work })).toThrow(/Site directory contains \.git/);
      rmSync(join(work, "site"), { recursive: true });

      const outside = mkdtempSync(join(homedir(), "ludion-nm-outside-"));
      try {
        symlinkSync(outside, join(work, "node_modules"), process.platform === "win32" ? "junction" : "dir");
        let message = "";
        try {
          buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work });
        } catch (err) {
          message = err instanceof Error ? err.message : "";
        }
        expect(message).toMatch(/Node modules directory/);
        expect(message).toMatch(/inside the runner temp directory/);
        expect(message).not.toContain(outside);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("makes the throwaway work directory writable for the fallback user", () => {
    const dir = mkdtempSync(join(tmpdir(), "ludion-wd-"));
    try {
      const before = statSync(dir).mode & 0o777;
      prepareSandboxWorkDir(dir);
      const after = statSync(dir).mode & 0o777;
      if (process.platform === "win32") {
        expect(statSync(dir).isDirectory()).toBe(true);
      } else if (sandboxUserIsFallback()) {
        expect(after).toBe(0o777);
      } else {
        expect(after).toBe(before);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const srcText = readFileSync(DOCKER_TS, "utf8");
    expect(srcText.slice(srcText.indexOf("export const runInDocker"))).toContain("prepareSandboxWorkDir(workDir)");
  });
});

describe("vite scratch directories", () => {
  function viteRoot(): { root: string; work: string; outside: string } {
    const root = mkdtempSync(join(tmpdir(), "ludion-vite-"));
    const work = join(root, "work");
    const outside = join(root, "outside");
    mkdirSync(work);
    mkdirSync(outside);
    return { root, work, outside };
  }

  it("mounts both scratch tmpfs after the read-only bind when the directories exist", () => {
    const { root, work } = viteRoot();
    const deps = join(root, "deps");
    mkdirSync(deps);
    try {
      const nm = join(work, "node_modules");
      mkdirSync(nm);
      mkdirSync(join(nm, ".vite-temp"));
      mkdirSync(join(nm, ".vite"));
      mkdirSync(join(work, "site"));
      const args = buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work, verifierDeps: deps });
      expectViteScratchTmpfs(args, [".vite-temp", ".vite"]);
      expect(valuesAfter(args, "--tmpfs")).toEqual([
        TMP_TMPFS,
        RUN_WORK_TMPFS,
        VITE_SCRATCH_TMPFS[".vite-temp"],
        VITE_SCRATCH_TMPFS[".vite"],
      ]);
      expect(mounts(args)).toEqual([
        `${dockerMountSource(nm)}:/w/node_modules:ro`,
        `${dockerMountSource(deps)}:/verifier:ro`,
      ]);
      expectRunMounts(args);
      expect(args.join(" ")).not.toMatch(/-v \S*\.vite/);

      const py = buildDockerRunArgs({ phase: "run", runtime: "python@3.12", name: "n", workDir: work });
      expect(valuesAfter(py, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);
      expect(py.join(" ")).not.toContain(":/w/node_modules");
      expect(mounts(py)).toEqual([`${dockerMountSource(join(work, "site"))}:/w/site:ro`]);
      expectRunMounts(py);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("omits a scratch tmpfs when that directory is absent and does not create it", () => {
    const { root, work } = viteRoot();
    try {
      const nm = join(work, "node_modules");
      mkdirSync(nm);
      const absent = buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work });
      expect(valuesAfter(absent, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);
      expect(absent.join("\n")).not.toContain("/w/node_modules/.vite");
      expect(mounts(absent)).toEqual([`${dockerMountSource(nm)}:/w/node_modules:ro`]);
      expectRunMounts(absent);
      expect(existsSync(join(nm, ".vite-temp"))).toBe(false);
      expect(existsSync(join(nm, ".vite"))).toBe(false);

      mkdirSync(join(nm, ".vite"));
      const onlyCache = buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work });
      expectViteScratchTmpfs(onlyCache, [".vite"]);
      expect(onlyCache.join("\n")).not.toContain(VITE_SCRATCH_TMPFS[".vite-temp"]);
      expectRunMounts(onlyCache);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not mount a symlinked or non-directory .vite-temp", () => {
    const { root, work, outside } = viteRoot();
    try {
      const nm = join(work, "node_modules");
      mkdirSync(nm);
      mkdirSync(join(nm, ".vite"));
      linkDir(outside, join(nm, ".vite-temp"));
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work })).toThrow(
        /Vite scratch directory \.vite-temp must be a real directory/,
      );
      expect(readdirSync(outside)).toEqual([]);

      rmSync(join(nm, ".vite-temp"), { recursive: true, force: true });
      writeFileSync(join(nm, ".vite-temp"), "not a directory\n");
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: work })).toThrow(
        /Vite scratch directory \.vite-temp must be a real directory/,
      );
      expect(readFileSync(join(nm, ".vite-temp"), "utf8")).toBe("not a directory\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates empty real scratch directories and rejects a symlink, a file, or a linked node_modules", () => {
    const { root, work, outside } = viteRoot();
    try {
      const nm = join(work, "node_modules");
      mkdirSync(join(nm, ".vite"), { recursive: true });
      writeFileSync(join(nm, ".vite", "keep.txt"), "keep");
      ensureViteScratchDirs(nm);
      for (const name of [".vite-temp", ".vite"] as const) {
        const st = lstatSync(join(nm, name));
        expect(st.isSymbolicLink(), name).toBe(false);
        expect(st.isDirectory(), name).toBe(true);
      }
      expect(readdirSync(join(nm, ".vite-temp"))).toEqual([]);
      expect(readFileSync(join(nm, ".vite", "keep.txt"), "utf8")).toBe("keep");
      ensureViteScratchDirs(nm);
      expect(readFileSync(join(nm, ".vite", "keep.txt"), "utf8")).toBe("keep");

      const linkedScratch = viteRoot();
      try {
        const linkedNm = join(linkedScratch.work, "node_modules");
        mkdirSync(linkedNm);
        linkDir(linkedScratch.outside, join(linkedNm, ".vite-temp"));
        expect(() => ensureViteScratchDirs(linkedNm)).toThrow(/Vite scratch directory \.vite-temp must be a real directory/);
        expect(readdirSync(linkedScratch.outside)).toEqual([]);
        expect(existsSync(join(linkedNm, ".vite"))).toBe(false);

        rmSync(join(linkedNm, ".vite-temp"), { recursive: true, force: true });
        writeFileSync(join(linkedNm, ".vite-temp"), "x");
        expect(() => ensureViteScratchDirs(linkedNm)).toThrow(/Vite scratch directory \.vite-temp must be a real directory/);
        expect(readFileSync(join(linkedNm, ".vite-temp"), "utf8")).toBe("x");
        expect(existsSync(join(linkedNm, ".vite"))).toBe(false);

        rmSync(join(linkedNm, ".vite-temp"), { force: true });
        writeFileSync(join(linkedNm, ".vite"), "file\n");
        expect(() => ensureViteScratchDirs(linkedNm)).toThrow(/Vite scratch directory \.vite must be a real directory/);
        expect(readFileSync(join(linkedNm, ".vite"), "utf8")).toBe("file\n");
      } finally {
        rmSync(linkedScratch.root, { recursive: true, force: true });
      }

      const escaped = viteRoot();
      try {
        linkDir(escaped.outside, join(escaped.work, "node_modules"));
        expect(() => ensureViteScratchDirs(join(escaped.work, "node_modules"))).toThrow(/node_modules must be a real directory/);
        expect(readdirSync(escaped.outside)).toEqual([]);
      } finally {
        rmSync(escaped.root, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates the scratch directories in runInDocker only after npm ci succeeds", () => {
    const body = readFileSync(DOCKER_TS, "utf8");
    const runBody = body.slice(body.indexOf("export const runInDocker"));
    const ciCall = runBody.indexOf('installArgs(spec.runtime, workDir, packages, "npm-ci"');
    const failure = runBody.indexOf("if (ciFailure) return ciFailure;");
    const scratch = runBody.indexOf('ensureViteScratchDirs(join(workDir, "node_modules"))');
    const lesson = runBody.lastIndexOf("dockerArgs(spec.runtime, name, workDir)");
    expect(ciCall).toBeGreaterThanOrEqual(0);
    expect(failure).toBeGreaterThan(ciCall);
    expect(scratch).toBeGreaterThan(failure);
    expect(lesson).toBeGreaterThan(scratch);
  });
});

describe("pinned images", () => {
  it("keeps the reviewed digests and refuses a floating tag", () => {
    expect(IMAGE_DIGESTS).toEqual({
      "node:18-slim": "sha256:f9ab18e354e6855ae56ef2b290dd225c1e51a564f87584b9bd21dd651838830e",
      "node:20-slim": "sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0",
      "node:22-slim": "sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d",
      "node:24-slim": "sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205",
      "python:3.9-slim": "sha256:2d97f6910b16bd338d3060f261f53f144965f755599aab1acda1e13cf1731b1b",
      "python:3.10-slim": "sha256:6ff506466f8b1e981719b468cc0023b8ef000b983cdec0eafe119d01f379e31d",
      "python:3.11-slim": "sha256:b7a9e5f6a93d6d4a31f129bbd4bdee69efccb6ded0fb230d78aafaf37af98377",
      "python:3.12-slim": "sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704",
      "python:3.13-slim": "sha256:d98cc29d3266e535dd9da1099688d9cb3ca4753813571e071763d17725460962",
      "python:3.14-slim": "sha256:35caba83af2fe6da9a5d922f9b0156f21d1246a48278c58a08bd253303ba42e8",
    });
    for (const digest of Object.values(IMAGE_DIGESTS)) expect(digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("maps every schema runtime, and the format 0 runners, to a pinned image", () => {
    const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as unknown;
    const runtimes = runtimeEnum(schema);
    const fromDigests = Object.keys(IMAGE_DIGESTS).map((tag) => {
      const [family, version] = tag.replace(/-slim$/, "").split(":");
      return `${family}@${version}`;
    });
    expect(runtimes.slice().sort()).toEqual(fromDigests.slice().sort());
    for (const runtime of runtimes) {
      const image = imageFor(runtime);
      expect(image, runtime).toBeDefined();
      expect(image!.image).toMatch(PIN);
      const tag = image!.image.split("@")[0]!;
      expect(image!.image).toBe(`${tag}@${IMAGE_DIGESTS[tag as keyof typeof IMAGE_DIGESTS]}`);
      const args = dockerArgs(runtime, "n");
      expect(args.filter((arg) => PIN.test(arg))).toEqual([image!.image]);
    }
    expect(imageFor("python")!.image).toBe(`python:3.14-slim@${IMAGE_DIGESTS["python:3.14-slim"]}`);
    expect(imageFor("bash")!.image).toBe(`python:3.14-slim@${IMAGE_DIGESTS["python:3.14-slim"]}`);
    expect(imageFor("bash")!.command).toEqual(["bash", "-s"]);
    expect(imageFor("node")!.image).toBe(`node:24-slim@${IMAGE_DIGESTS["node:24-slim"]}`);
    expect(imageFor("ruby@3")).toBeUndefined();
    expect(imageFor("node@19")).toBeUndefined();
    expect(imageFor("node@24-slim")).toBeUndefined();
    expect(imageFor("python@3")).toBeUndefined();
    expect(imageFor("python@3.8")).toBeUndefined();
    expect(() => dockerArgs("ruby@3", "n")).toThrow(/Unknown runtime ruby@3/);
    expect(() => installArgs("node@19", "/tmp/w", { vitest: "5.0.3" }, "npm-lock", "ludion-install-npm")).toThrow(/Unknown runtime/);
    const pull = readFileSync(DOCKER_TS, "utf8");
    const pullFn = pull.slice(pull.indexOf("export function pullImages"), pull.indexOf("export function resolveSandboxUser"));
    expect(pullFn).toContain("imageFor(r)?.image");
    expect(pullFn).toContain('["pull", "--quiet", image]');
    expect(pullFn).toContain("not pinned by digest");
  });
});

// The repository-wide guard on who may start a container is packages/sandbox/test/guard.test.ts.
describe("docker run construction", () => {
  it("starts a run argument list only inside buildDockerRunArgs", () => {
    const src = readFileSync(DOCKER_TS, "utf8");
    const fnAt = src.indexOf("export function buildDockerRunArgs");
    const arrayAt = src.search(/\[\s*"run"/);
    expect(fnAt).toBeGreaterThanOrEqual(0);
    expect(arrayAt).toBeGreaterThan(fnAt);
    const after = src.slice(fnAt);
    const next = after.slice(1).search(/\nexport function /);
    expect(next).toBeGreaterThan(0);
    const body = after.slice(0, next + 1);
    expect(body).toMatch(/\[\s*"run"/);
    expect(src.slice(0, fnAt)).not.toMatch(/\[\s*["']run["']|\.push\(\s*["']run["']|`run`|`run /);
    expect(src.slice(fnAt + body.length)).not.toMatch(/\[\s*["']run["']|\.push\(\s*["']run["']|`run`|`run /);
    expect(src).not.toMatch(/spawn(?:Sync)?\(\s*"docker"\s*,\s*\[\s*"run"/);
  });

  it("mounts verifier deps from buildDockerRunArgs with a literal :ro", () => {
    const src = readFileSync(DOCKER_TS, "utf8");
    const fnAt = src.indexOf("export function buildDockerRunArgs");
    const after = src.slice(fnAt);
    const next = after.slice(1).search(/\nexport function /);
    const body = after.slice(0, next + 1);
    expect(body).toContain(":/verifier:ro");
    expect(body).not.toContain(":/verifier:rw");
    expect(body).not.toContain(":/verifier\"");
    expect(body).toContain(":/w/node_modules:ro");
    expect(body).toContain(":/w/site:ro");
    expect(body).toContain("--tmpfs\", \"/w:rw,noexec,nosuid,nodev,size=128m,mode=1777");
    expect(body).not.toContain(":/w:ro");
    expect(body).not.toContain(":/w:rw");
  });
});

describe("verifier deps mount", () => {
  it("bind-mounts verifier deps read-only on run and refuses install, overlap, and a dropped :ro", () => {
    const parent = mkdtempSync(join(tmpdir(), "ludion-mount-"));
    const work = join(parent, "work");
    const workExtra = join(parent, "work-extra");
    const deps = join(parent, "deps");
    const nested = join(work, "nested-deps");
    mkdirSync(work);
    mkdirSync(workExtra);
    mkdirSync(deps);
    mkdirSync(nested);
    try {
      const args = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work, verifierDeps: deps });
      expectHardened(args, "run");
      const bound = mounts(args);
      expect(bound).toHaveLength(1);
      expect(bound.some((mount) => mountDestination(mount) === "/w")).toBe(false);
      const verifierMount = bound.find((mount) => mount.includes(":/verifier"));
      expect(verifierMount).toMatch(/:\/verifier:ro$/);
      expect(verifierMount).not.toMatch(/:rw\b/);
      expect(args.filter((arg) => arg === "--read-only")).toEqual(["--read-only"]);
      expect(valueAfter(args, "--network")).toBe("none");

      mkdirSync(join(work, "node_modules"));
      const withModules = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work, verifierDeps: deps });
      expect(mounts(withModules)).toEqual([
        `${dockerMountSource(join(work, "node_modules"))}:/w/node_modules:ro`,
        `${dockerMountSource(deps)}:/verifier:ro`,
      ]);
      expect(mounts(withModules).some((mount) => mountDestination(mount) === "/w")).toBe(false);
      expectRunMounts(withModules);

      const prefix = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work, verifierDeps: workExtra });
      expect(mounts(prefix).some((mount) => mount.endsWith(":/verifier:ro"))).toBe(true);

      const onlyVerifier = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", verifierDeps: deps });
      expectHardened(onlyVerifier, "run");
      expect(mounts(onlyVerifier)).toEqual([expect.stringMatching(/:\/verifier:ro$/)]);
      expect(onlyVerifier.join(" ")).not.toContain(":/w");

      expect(() => buildDockerRunArgs({
        phase: "install",
        runtime: "node@24",
        name: "ludion-install-1",
        workDir: work,
        packages: { vitest: "5.0.3" },
        installStep: "npm-lock",
        verifierDeps: deps,
      })).toThrow(/verifierDeps is only allowed for the run phase/);
      const installDir = join(parent, "install");
      mkdirSync(installDir);
      seedInstall(installDir, "npm-lock");
      expect(installArgs("node@24", installDir, { vitest: "5.0.3" }, "npm-lock", "ludion-install-npm").join(" ")).not.toContain("/verifier");

      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work, verifierDeps: nested })).toThrow(/overlap/);
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: nested, verifierDeps: work })).toThrow(/overlap/);
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work, verifierDeps: work })).toThrow(/overlap/);
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", verifierDeps: "relative/deps" })).toThrow(/Verifier deps directory/);
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", verifierDeps: "/tmp/deps,rw" })).toThrow(/Verifier deps directory/);
      expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", verifierDeps: "/tmp/../etc" })).toThrow(/Verifier deps directory/);
      expect(() => buildDockerRunArgs({
        phase: "run",
        runtime: "node",
        name: "n",
        verifierDeps: deps,
        readOnly: false,
      } as DockerRunOptions)).toThrow(/Unknown docker option readOnly/);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("install environment", () => {
  it("passes an explicit allowlist for every phase and never a host variable", () => {
    withWork((work) => {
      const run = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", workDir: work });
      const bare = buildDockerRunArgs({ phase: "run", runtime: "node", name: "n" });
      seedInstall(work, "npm-lock");
      const lock = installArgs("node@24", work, { vitest: "5.0.3" }, "npm-lock", "ludion-install-lock");
      seedInstall(work, "npm-ci");
      const ci = installArgs("node@24", work, { vitest: "5.0.3" }, "npm-ci", "ludion-install-ci");
      seedInstall(work, "pip");
      const pip = installArgs("python@3.12", work, { requests: "2.32.0" }, "pip", "ludion-install-pip");
      expect(envPairs(run)).toEqual(RUN_ENV);
      expect(envPairs(bare)).toEqual([]);
      expect(envPairs(lock)).toEqual(NPM_INSTALL_ENV);
      expect(envPairs(ci)).toEqual(NPM_INSTALL_ENV);
      expect(envPairs(pip)).toEqual(PIP_INSTALL_ENV);
      expect(valuesAfter(run, "--tmpfs")).toEqual([TMP_TMPFS, RUN_WORK_TMPFS]);
      expect(mounts(run)).toEqual([]);
      expectRunMounts(run);
      expect(workMount(lock)).toMatch(/:\/w$/);
      expect(workMount(ci)).toMatch(/:\/w$/);
      expect(workMount(pip)).toMatch(/:\/w$/);
      for (const args of [run, bare, lock, ci, pip]) {
        expect(args).not.toContain("--env-file");
        for (let i = 0; i < args.length; i++) {
          if (args[i] !== "-e") continue;
          const value = args[i + 1];
          expect(value).toMatch(/^[A-Za-z_][A-Za-z0-9_]*=.+/);
          expect(value).not.toMatch(SECRET_ENV);
        }
      }
      expect(() => installArgs("python@3.12", work, { requests: "2.32.0" }, "npm-lock", "n")).toThrow(/npm install requires a node runtime/);
      expect(() => installArgs("node@24", work, { vitest: "1.2.3" }, "pip", "n")).toThrow(/pip install requires a python runtime/);
    });
  });
});

describe("mount sources stay inside the runner temp directory", () => {
  it("rejects the repo, a home directory, a socket path, and a non-directory", () => {
    const repo = REPO.replace(/[\\/]+$/, "");
    const home = homedir().replace(/[\\/]+$/, "");
    expect(() => dockerMountSource(repo)).toThrow(/inside the runner temp directory|contains \.git|git work tree/);
    expect(() => dockerMountSource(home)).toThrow(/inside the runner temp directory|contains \.git|git work tree/);
    expect(() => dockerMountSource("/var/run/docker.sock")).toThrow(/Work directory/);
    expect(() => dockerMountSource("/proc/self/root/etc")).toThrow(/Work directory/);
    withWork((work) => {
      writeFileSync(join(work, "docker.sock"), "");
      expect(() => dockerMountSource(join(work, "docker.sock"))).toThrow(/existing directory/);
    });
  });

  it("rejects a temp directory that contains .git or sits inside a git work tree", () => {
    withWork((work) => {
      mkdirSync(join(work, ".git"));
      expect(() => dockerMountSource(work)).toThrow(/contains \.git/);
      rmSync(join(work, ".git"), { recursive: true, force: true });
      writeFileSync(join(work, ".git"), "gitdir: elsewhere\n");
      let message = "";
      try {
        dockerMountSource(work);
      } catch (err) {
        message = err instanceof Error ? err.message : "";
      }
      expect(message).toMatch(/contains \.git/);
      expect(message).not.toContain(work);
      rmSync(join(work, ".git"));
      const child = join(work, "child");
      mkdirSync(join(work, ".git"));
      mkdirSync(child);
      expect(() => dockerMountSource(child)).toThrow(/inside a git work tree/);
    });
  });

  it("rejects a symlink or junction whose target leaves the temp directory", () => {
    const parent = mkdtempSync(join(tmpdir(), "ludion-link-"));
    const outside = mkdtempSync(join(homedir(), "ludion-outside-"));
    const link = join(parent, "escape");
    try {
      symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
      let message = "";
      try {
        dockerMountSource(link);
      } catch (err) {
        message = err instanceof Error ? err.message : "";
      }
      expect(message).toMatch(/inside the runner temp directory/);
      expect(message).not.toContain(outside);
    } finally {
      rmSync(parent, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts a directory under RUNNER_TEMP when that variable is set", () => {
    const outside = mkdtempSync(join(homedir(), "ludion-runner-"));
    const previous = process.env.RUNNER_TEMP;
    process.env.RUNNER_TEMP = outside;
    try {
      const source = dockerMountSource(outside);
      expect(source.startsWith("/")).toBe(true);
      mkdirSync(join(outside, ".git"));
      expect(() => dockerMountSource(outside)).toThrow(/contains \.git/);
    } finally {
      if (previous === undefined) delete process.env.RUNNER_TEMP;
      else process.env.RUNNER_TEMP = previous;
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("install work directory", () => {
  function fill(dir: string, step: InstallStep): void {
    if (step === "pip") writeFileSync(join(dir, "requirements.txt"), "requests==2.32.0 --hash=sha256:" + "ab".repeat(32) + "\n");
    else writeFileSync(join(dir, "package.json"), "{}\n");
    if (step === "npm-ci") {
      writeFileSync(join(dir, "package-lock.json"), "{}\n");
      mkdirSync(join(dir, ".home"));
      mkdirSync(join(dir, ".npm"));
    }
  }

  it("allows only the files for that step", () => {
    withWork((work) => {
      fill(work, "npm-lock");
      expect(() => assertInstallWorkDirClean(work, "npm-lock")).not.toThrow();
      fill(work, "npm-ci");
      expect(() => assertInstallWorkDirClean(work, "npm-ci")).not.toThrow();
      rmSync(work, { recursive: true, force: true });
      mkdirSync(work);
      fill(work, "pip");
      expect(() => assertInstallWorkDirClean(work, "pip")).not.toThrow();
    });
  });

  it("rejects credential files, extra files, node_modules, and a symlink", () => {
    withWork((work) => {
      fill(work, "npm-lock");
      writeFileSync(join(work, ".npmrc"), "token=1\n");
      expect(() => assertInstallWorkDirClean(work, "npm-lock")).toThrow(/contains \.npmrc/);
      rmSync(join(work, ".npmrc"));
      writeFileSync(join(work, ".pypirc"), "x\n");
      expect(() => assertInstallWorkDirClean(work, "npm-lock")).toThrow(/contains \.pypirc/);
      rmSync(join(work, ".pypirc"));
      writeFileSync(join(work, "pip.conf"), "x\n");
      expect(() => assertInstallWorkDirClean(work, "npm-lock")).toThrow(/contains pip\.conf/);
      rmSync(join(work, "pip.conf"));
      writeFileSync(join(work, "README"), "x\n");
      let message = "";
      try {
        assertInstallWorkDirClean(work, "npm-lock");
      } catch (err) {
        message = err instanceof Error ? err.message : "";
      }
      expect(message).toMatch(/unexpected file \(README\)/);
      expect(message).not.toContain(work);
      rmSync(join(work, "README"));
      mkdirSync(join(work, "node_modules"));
      expect(() => assertInstallWorkDirClean(work, "npm-lock")).toThrow(/unexpected directory \(node_modules\)/);
      rmSync(join(work, "node_modules"), { recursive: true });
      mkdirSync(join(work, ".home"));
      expect(() => assertInstallWorkDirClean(work, "npm-lock")).toThrow(/unexpected directory \(\.home\)/);
      rmSync(join(work, ".home"), { recursive: true });
      const outside = mkdtempSync(join(tmpdir(), "ludion-linktarget-"));
      try {
        symlinkSync(outside, join(work, "link"), process.platform === "win32" ? "junction" : "dir");
        expect(() => assertInstallWorkDirClean(work, "npm-lock")).toThrow(/symlink \(link\)/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("makes the args builder throw when the install directory holds anything else", () => {
    withWork((work) => {
      writeFileSync(join(work, "package.json"), "{}\n");
      writeFileSync(join(work, "lesson.test.ts"), "console.log(1)\n");
      const opts = {
        phase: "install" as const,
        runtime: "node@24",
        name: "n",
        workDir: work,
        packages: { vitest: "5.0.3" },
        installStep: "npm-lock" as const,
      };
      expect(() => buildDockerRunArgs(opts)).toThrow(/unexpected file \(lesson\.test\.ts\)/);
      rmSync(join(work, "lesson.test.ts"));
      writeFileSync(join(work, ".npmrc"), "token=1\n");
      expect(() => buildDockerRunArgs(opts)).toThrow(/contains \.npmrc/);
      rmSync(join(work, ".npmrc"));
      writeFileSync(join(work, ".pypirc"), "x\n");
      expect(() => buildDockerRunArgs(opts)).toThrow(/contains \.pypirc/);
      rmSync(join(work, ".pypirc"));
      writeFileSync(join(work, "pip.conf"), "x\n");
      expect(() => buildDockerRunArgs(opts)).toThrow(/contains pip\.conf/);
      rmSync(join(work, "pip.conf"));
      const outside = mkdtempSync(join(tmpdir(), "ludion-linktarget-"));
      try {
        symlinkSync(outside, join(work, "link"), process.platform === "win32" ? "junction" : "dir");
        expect(() => buildDockerRunArgs(opts)).toThrow(/symlink \(link\)/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it("refuses node_modules before npm ci and a missing lockfile", () => {
    withWork((work) => {
      fill(work, "npm-ci");
      mkdirSync(join(work, "node_modules"));
      expect(() => assertInstallWorkDirClean(work, "npm-ci")).toThrow(/node_modules/);
      rmSync(join(work, "node_modules"), { recursive: true });
      rmSync(join(work, "package-lock.json"));
      expect(() => assertInstallWorkDirClean(work, "npm-ci")).toThrow(/missing package-lock\.json/);
    });
  });
});

describe("npm lockfile and pip requirements", () => {
  const registry = "https://registry.npmjs.org/left-pad/-/left-pad-1.2.3.tgz";

  function lock(extra: Record<string, unknown> = {}, version = "1.2.3"): unknown {
    return {
      lockfileVersion: 3,
      packages: {
        "": { dependencies: { "left-pad": version } },
        "node_modules/left-pad": {
          version,
          resolved: registry,
          integrity: "sha512-abc",
        },
        ...extra,
      },
    };
  }

  it("accepts a registry lockfile and the pinned version", () => {
    expect(() => checkNpmLockfile(lock(), { "left-pad": "1.2.3" })).not.toThrow();
    expect(() => checkNpmLockfile(lock({}, "1.2.3"), { "@scope/left-pad": "1.2.3" })).toThrow(/missing node_modules\/@scope\/left-pad/);
    const scoped = lock({
      "node_modules/@scope/left-pad": { version: "1.2.3", resolved: "https://registry.npmjs.org/@scope/left-pad/-/left-pad-1.2.3.tgz", integrity: "sha512-abc" },
    });
    expect(() => checkNpmLockfile(scoped, { "@scope/left-pad": "1.2.3", "left-pad": "1.2.3" })).not.toThrow();
  });

  it("rejects an old lockfile, a link, a non-registry spec, a bad integrity, and a version mismatch", () => {
    expect(() => checkNpmLockfile({ ...lock() as object, lockfileVersion: 1 }, { "left-pad": "1.2.3" })).toThrow(/lockfileVersion/);
    const linked = lock({ "node_modules/other": { version: "1.0.0", link: true, resolved: "other" } });
    expect(() => checkNpmLockfile(linked, { "left-pad": "1.2.3" })).toThrow(/is a link/);
    const git = lock({
      "node_modules/other": { version: "1.0.0", resolved: "git+https://github.com/example/other.git", integrity: "sha512-abc" },
    });
    expect(() => checkNpmLockfile(git, { "left-pad": "1.2.3" })).toThrow(/not resolved from the npm registry/);
    const fileSpec = lock();
    (fileSpec as { packages: Record<string, { dependencies?: Record<string, string> }> }).packages[""]!.dependencies = { "left-pad": "file:../left-pad" };
    expect(() => checkNpmLockfile(fileSpec, { "left-pad": "1.2.3" })).toThrow(/not from the npm registry/);
    const sha1 = lock({ "node_modules/left-pad": { version: "1.2.3", resolved: registry, integrity: "sha1-abc" } });
    expect(() => checkNpmLockfile(sha1, { "left-pad": "1.2.3" })).toThrow(/no sha512 integrity/);
    expect(() => checkNpmLockfile(lock({}, "9.9.9"), { "left-pad": "1.2.3" })).toThrow(/version is not 1\.2\.3/);
  });

  it("builds requirements.txt only when every pin has a sha256 hash", () => {
    const hash = `sha256:${"ab".repeat(32)}`;
    expect(buildRequirementsTxt([{ name: "requests", version: "2.32.0", hash }])).toBe(`requests==2.32.0 --hash=${hash}\n`);
    expect(() => buildRequirementsTxt([{ name: "requests", version: "2.32.0" }])).toThrow(/needs --hash=sha256/);
    expect(() => buildRequirementsTxt([{ name: "requests", version: "2.32.0", hash: "sha256:ABCD" }])).toThrow(/needs --hash=sha256/);
    expect(() => buildRequirementsTxt([{ name: "requests", version: "2.32.0", hash: `sha512:${"ab".repeat(32)}` }])).toThrow(/needs --hash=sha256/);
    expect(() => buildRequirementsTxt([])).toThrow(/empty/);
  });

  it("does not start pip when the lesson gives no hashes", async () => {
    const result = await runInDocker({ runtime: "python@3.12", code: "print(1)\n", packages: { requests: "2.32.0" } });
    expect(result).toEqual({ kind: "error", reason: "pip install needs --require-hashes; the lesson gives no hashes" });
    const body = readFileSync(DOCKER_TS, "utf8");
    const runBody = body.slice(body.indexOf("export const runInDocker"));
    expect(runBody.match(/assertInstallWorkDirClean\(/g)).toHaveLength(2);
    expect(runBody).toContain('"npm-lock"');
    expect(runBody).toContain('"npm-ci"');
    expect(runBody).toContain("npm lockfile is unreadable.");
  });
});
