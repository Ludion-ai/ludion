import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildDockerRunArgs,
  dockerArgs,
  dockerMountSource,
  imageFor,
  IMAGE_DIGESTS,
  installArgs,
  prepareSandboxWorkDir,
  resolveSandboxUser,
  sandboxUserIsFallback,
  type DockerRunOptions,
} from "../src/docker.ts";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const DOCKER_TS = fileURLToPath(new URL("../src/docker.ts", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../../../lessons/lessons.schema.json", import.meta.url));

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
  const tmpfs = valueAfter(args, "--tmpfs");
  expect(tmpfs).toBe("/tmp:rw,noexec,nosuid,nodev,size=64m");
  expect(tmpfs).toContain("noexec,nosuid");
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

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

describe("docker run hardening", () => {
  const cases: { phase: "run" | "install"; opts: DockerRunOptions }[] = [
    { phase: "run", opts: { phase: "run", runtime: "node", name: "n" } },
    { phase: "run", opts: { phase: "run", runtime: "python@3.12", name: "ludion-verify-1", workDir: "/tmp/w" } },
    { phase: "install", opts: { phase: "install", runtime: "node@24", name: "ludion-install-1" } },
    { phase: "install", opts: { phase: "install", runtime: "python@3.14", name: "ludion-install-2", workDir: "/var/tmp/lesson", packages: { requests: "2.32.0" } } },
  ];

  it("puts every hardening flag on both phases, with and without a work directory", () => {
    for (const { phase, opts } of cases) {
      const args = buildDockerRunArgs(opts);
      expectHardened(args, phase);
      if (opts.workDir === undefined) expect(args).not.toContain("-v");
      else expect(valueAfter(args, "-v")).toMatch(/^[^,:]+:\/w$/);
    }
  });

  it("keeps the network on the phase: run is always none, install never sets it", () => {
    const run = dockerArgs("node@24", "n", "/tmp/w");
    const bare = dockerArgs("bash", "n");
    const npm = installArgs("node@24", "/tmp/w", { vitest: "5.0.3" }, "ludion-install-npm");
    const pip = installArgs("python@3.12", "/tmp/w", { requests: "2.32.0" }, "ludion-install-pip");
    expect(valueAfter(run, "--network")).toBe("none");
    expect(valueAfter(bare, "--network")).toBe("none");
    expect(npm).not.toContain("--network");
    expect(pip).not.toContain("--network");
    expect(dockerArgs("node", "n")).toEqual(buildDockerRunArgs({ phase: "run", runtime: "node", name: "n" }));
    expect(dockerArgs("node@24", "n", "/tmp/w")).toEqual(buildDockerRunArgs({ phase: "run", runtime: "node@24", name: "n", workDir: "/tmp/w" }));
    expect(npm).toEqual(buildDockerRunArgs({ phase: "install", runtime: "node@24", name: "ludion-install-npm", workDir: "/tmp/w", packages: { vitest: "5.0.3" } }));
  });

  it("runs no lesson code in the install phase", () => {
    const npm = installArgs("node@24", "/tmp/w", { vitest: "5.0.3" }, "ludion-install-npm");
    const pip = installArgs("python@3.12", "/tmp/w", { requests: "2.32.0" }, "ludion-install-pip");
    const npmImage = imageFor("node@24")!.image;
    const pipImage = imageFor("python@3.12")!.image;
    expect(npm.slice(npm.indexOf(npmImage) + 1)).toEqual(["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"]);
    expect(pip.slice(pip.indexOf(pipImage) + 1)).toEqual([
      "pip", "install", "--no-cache-dir", "--only-binary", ":all:", "--target", "/w/site", "requests==2.32.0",
    ]);
    expect(npm).not.toContain("-");
    expect(npm).not.toContain("vitest");
    expect(pip).not.toContain("-");
    const withCode = {
      phase: "install" as const,
      runtime: "node@24",
      name: "ludion-install-npm",
      workDir: "/tmp/w",
      packages: { vitest: "5.0.3" },
      code: "process.exit(0)",
    };
    expect(() => buildDockerRunArgs(withCode)).toThrow(/Unknown docker option code/);
    expect(() => buildDockerRunArgs({ phase: "run", runtime: "node", name: "n", packages: { vitest: "5.0.3" } })).toThrow(/run phase does not take packages/);
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
    expect(() => installArgs("python@3.12", "/tmp/w", { "requests;x": "2.32.0" }, "ludion-install-pip")).toThrow(/Package/);
    expect(() => installArgs("python@3.12", "/tmp/w", { requests: "2.32.0\n--index-url=http://evil" }, "ludion-install-pip")).toThrow(/Package/);
    expect(() => installArgs("node@24", "/tmp/w", { "--unsafe-perm": "1.2.3" }, "ludion-install-npm")).toThrow(/Package/);
    expect(() => buildDockerRunArgs({ phase: "host" as "run", runtime: "node", name: "n" })).toThrow(/Unknown docker phase/);
    // A rejected call returns nothing, so it cannot be a weaker docker run.
    const safe = dockerArgs("node", "still-safe", "/var/tmp/lesson");
    expectHardened(safe, "run");
    expect(valueAfter(safe, "--network")).toBe("none");
    expect(valueAfter(safe, "--user")).not.toBe("0:0");
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
    expect(valueAfter(installArgs("node", "/tmp/w", { vitest: "5.0.3" }, "ludion-install-npm"), "--user")).toBe(expected);
    expect(expected).toMatch(USER);
    const hostUsable = typeof uid === "number" && typeof gid === "number" && uid > 0 && gid > 0;
    expect(sandboxUserIsFallback()).toBe(!hostUsable);
  });

  it("rewrites a Windows drive path and leaves a posix mount source unchanged", () => {
    expect(dockerMountSource("/tmp/w")).toBe("/tmp/w");
    expect(dockerMountSource("C:\\work\\lesson")).toBe("/c/work/lesson");
    expect(dockerMountSource("D:/pack/age")).toBe("/d/pack/age");
    const args = dockerArgs("node", "n", "C:\\Users\\haya0\\AppData\\Local\\Temp\\ludion-test");
    expect(valueAfter(args, "-v")).toBe("/c/Users/haya0/AppData/Local/Temp/ludion-test:/w");
    expect(valueAfter(dockerArgs("python", "n", "/tmp/w"), "-v")).toBe("/tmp/w:/w");
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
    expect(() => installArgs("node@19", "/tmp/w", { vitest: "5.0.3" }, "ludion-install-npm")).toThrow(/Unknown runtime/);
    const pull = readFileSync(DOCKER_TS, "utf8");
    const pullFn = pull.slice(pull.indexOf("export function pullImages"), pull.indexOf("export function resolveSandboxUser"));
    expect(pullFn).toContain("imageFor(r)?.image");
    expect(pullFn).toContain('["pull", "--quiet", image]');
    expect(pullFn).toContain("not pinned by digest");
  });
});

describe("docker run construction", () => {
  it("starts a run argument list only inside buildDockerRunArgs", () => {
    const hits: string[] = [];
    for (const file of tsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      const re = /\[\s*["']run["']/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const line = text.slice(0, match.index).split("\n").length;
        const src = SRC.replaceAll("\\", "/").replace(/\/$/, "");
        const rel = file.replaceAll("\\", "/").startsWith(src)
          ? file.replaceAll("\\", "/").slice(src.length + 1)
          : file;
        hits.push(`${rel}:${line}`);
      }
    }
    expect(hits).toEqual([expect.stringMatching(/^docker\.ts:\d+$/)]);
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
    expect(src.slice(0, fnAt)).not.toMatch(/\[\s*"run"/);
    expect(src.slice(fnAt + body.length)).not.toMatch(/\[\s*"run"/);
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
  });
});

describe("verifier deps mount", () => {
  function mounts(args: readonly string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < args.length; i++) if (args[i] === "-v") out.push(args[i + 1] ?? "");
    return out;
  }

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
      expect(bound).toHaveLength(2);
      const workMount = bound.find((mount) => mount.endsWith(":/w"));
      const verifierMount = bound.find((mount) => mount.includes(":/verifier"));
      expect(workMount).toBeDefined();
      expect(workMount).not.toContain(":ro");
      expect(verifierMount).toMatch(/:\/verifier:ro$/);
      expect(verifierMount).not.toMatch(/:rw\b/);
      expect(args.filter((arg) => arg === "--read-only")).toEqual(["--read-only"]);
      expect(valueAfter(args, "--network")).toBe("none");

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
        verifierDeps: deps,
      })).toThrow(/verifierDeps is only allowed for the run phase/);
      expect(installArgs("node@24", work, { vitest: "5.0.3" }, "ludion-install-npm").join(" ")).not.toContain("/verifier");

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
