import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { dockerCwd, findDocker, findProgram, NPM_BOX_MEMORY, readSwapMax, runArgs, runContainer, runDockerImageCommand } from "../src/docker.ts";

// The module takes no spawn parameter (a caller could otherwise rewrite the argv), so tests replace node's spawn.
const current = vi.hoisted(() => ({ spawn: undefined as unknown as (cmd: string, args: readonly string[], options: unknown) => unknown }));
vi.mock("node:child_process", () => ({ spawn: (cmd: string, args: readonly string[], options: unknown) => current.spawn(cmd, args, options) }));

const IMAGE = `sha256:${"a".repeat(64)}`;
const ISOLATION = ["--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534"];
const LIMITS_AFTER_MEMORY = ["--pids-limit", "256", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m"];
const HARDENED = [...ISOLATION, "--cpus", "1", "--memory", "512m", ...LIMITS_AFTER_MEMORY];
// Written out, not read from NPM_BOX_MEMORY: this list is what the box must be.
const NPM_HARDENED = [...ISOLATION, "--cpus", "1", "--memory", "4g", "--memory-swap", "4g", ...LIMITS_AFTER_MEMORY];
const flag = (args: readonly string[], name: string) => args.filter((_, i) => args[i - 1] === name);

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.emit("close", null); return true; };
  return child;
}
function fakeSpawn(onSpawn: (args: readonly string[], child: FakeChild) => void = () => {}) {
  const calls: { cmd: string; args: readonly string[]; options: unknown; child: FakeChild }[] = [];
  current.spawn = (cmd, args, options) => {
    const child = fakeChild();
    calls.push({ cmd, args, options, child });
    onSpawn(args, child);
    return child;
  };
  return { calls };
}

// A docker for findDocker to find, in an absolute PATH folder outside the working directory; spawn itself is faked.
const bin = mkdtempSync(join(tmpdir(), "ludion-bin-"));
const DOCKER = join(bin, process.platform === "win32" ? "docker.exe" : "docker");
const savedPath = process.env.PATH;
beforeAll(() => { writeFileSync(DOCKER, ""); chmodSync(DOCKER, 0o755); process.env.PATH = bin; });
afterAll(() => { process.env.PATH = savedPath; rmSync(bin, { recursive: true, force: true }); });

describe("security test container arguments", () => {
  it("are the fixed hardened argv, with the test argv only after the image", () => {
    expect(runArgs("ludion-security-1-candidate-test", IMAGE, ["php", "tests/smoke.php"])).toEqual([
      "run", "--rm", "--name", "ludion-security-1-candidate-test", ...HARDENED, "--entrypoint", "php", IMAGE, "tests/smoke.php",
    ]);
  });
  it("add only fixed container scratch directories and HOME=/tmp for a package manager", () => {
    const scratch = "rw,noexec,nosuid,nodev,size=32m,mode=1777";
    expect(runArgs("n", IMAGE, ["npm", "test"], "npm")).toEqual([
      "run", "--rm", "--name", "n", ...NPM_HARDENED, "--tmpfs", `/app/node_modules/.vite:${scratch}`, "--tmpfs", `/app/node_modules/.vite-temp:${scratch}`,
      "--env", "HOME=/tmp", "--entrypoint", "npm", IMAGE, "test",
    ]);
    expect(runArgs("n", IMAGE, ["php", "t.php"], "composer")).toEqual([
      "run", "--rm", "--name", "n", ...HARDENED, "--tmpfs", `/app/.phpunit.cache:${scratch}`, "--env", "HOME=/tmp", "--entrypoint", "php", IMAGE, "t.php",
    ]);
    expect(runArgs("n", IMAGE, ["mvn", "verify"], "maven")).toEqual([
      "run", "--rm", "--name", "n", ...HARDENED, "--tmpfs", "/app/target:rw,noexec,nosuid,nodev,size=256m,mode=1777", "--env", "HOME=/tmp", "--entrypoint", "mvn", IMAGE, "verify",
    ]);
    expect(() => runArgs("n", IMAGE, ["sh"], "pip" as "npm")).toThrow("Unsupported security test tool");
    expect(() => runArgs("n", IMAGE, ["sh"], "--privileged" as "npm")).toThrow("Unsupported security test tool");
  });
  it("gate3-box-has-no-swap: npm's box, validation's and gate 3's, has one CPU and --memory-swap equal to --memory", () => {
    const args = runArgs("n", IMAGE, ["node", "/ludion/driver.cjs"], "npm");
    expect(flag(args, "--cpus")).toEqual(["1"]);
    expect(flag(args, "--memory")).toEqual(["4g"]);
    expect(flag(args, "--memory-swap")).toEqual(flag(args, "--memory"));
    // Every other flag of the isolation is still there.
    expect(args.join(" ")).toContain(ISOLATION.join(" "));
    expect(args.join(" ")).toContain(LIMITS_AFTER_MEMORY.join(" "));
    expect(flag(args, "--mount").concat(flag(args, "--volume"), flag(args, "-v"))).toEqual([]);
  });
  it("leave Composer's, Maven's and the official images' boxes as they were", () => {
    for (const tool of ["composer", "maven", undefined] as const) {
      const args = runArgs("n", IMAGE, ["sh"], tool);
      expect(flag(args, "--cpus")).toEqual(["1"]);
      expect(flag(args, "--memory")).toEqual(["512m"]);
      expect(args).not.toContain("--memory-swap");
    }
  });
  it("box-size-is-one-number: the decision, gate 3's definition, the constant and the arguments say the same", () => {
    const args = runArgs("n", IMAGE, ["sh"], "npm");
    const flags = args.slice(args.indexOf("--cpus"), args.indexOf("--pids-limit")).join(" ");
    expect(flags).toBe(`--cpus 1 --memory ${NPM_BOX_MEMORY} --memory-swap ${NPM_BOX_MEMORY}`);
    for (const path of ["2026-11-03-box-one-cpu-4g-no-swap.md", "2026-11-02-gate-3-type-definition.md"]) {
      expect(readFileSync(new URL(`../../../docs/decisions/${path}`, import.meta.url), "utf8")).toContain(`\`${flags}\``);
    }
  });
  it("refuse unsafe names, tags instead of image IDs and flag-like or empty test argv", () => {
    expect(() => runArgs("two words", IMAGE, ["php"])).toThrow("single safe token");
    expect(() => runArgs("-x", IMAGE, ["php"])).toThrow("single safe token");
    expect(() => runArgs("t", "php:8.4.27-cli-alpine", ["php"])).toThrow("immutable");
    expect(() => runArgs("t", `php@sha256:${"a".repeat(64)}`, ["php"])).toThrow("immutable");
    expect(() => runArgs("t", IMAGE, [])).toThrow("nonempty");
    expect(() => runArgs("t", IMAGE, ["--privileged", "php"])).toThrow("nonempty");
    expect(() => runArgs("t", IMAGE, ["php", "a\0b"])).toThrow("nonempty");
    expect(() => runArgs("t", IMAGE, ["php", ""])).toThrow("nonempty");
  });
});

describe("Docker image commands", () => {
  it("allow only pull, build, image inspect and image rm", async () => {
    const { calls } = fakeSpawn();
    for (const args of [["run", "php"], ["exec", "x", "sh"], ["image", "ls"], ["image", "save", "php"], ["container", "rm", "x"], []]) {
      await expect(runDockerImageCommand(args, 1_000)).rejects.toThrow("Only Docker image retrieval");
    }
    expect(calls).toEqual([]);
  });
  it("return trimmed output, and reject on a non-zero exit, a timeout or a missing Docker", async () => {
    const ok = fakeSpawn((_args, child) => queueMicrotask(() => { child.stdout.emit("data", "sha256:abc\n"); child.emit("close", 0); }));
    await expect(runDockerImageCommand(["image", "inspect", "x"], 1_000)).resolves.toBe("sha256:abc");
    expect(ok.calls[0]!.options).toEqual({ cwd: dockerCwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    fakeSpawn((_args, child) => queueMicrotask(() => { child.stderr.emit("data", "manifest unknown"); child.emit("close", 1); }));
    await expect(runDockerImageCommand(["pull", "x"], 1_000)).rejects.toThrow("Docker image command failed (1): manifest unknown");
    fakeSpawn();
    await expect(runDockerImageCommand(["pull", "x"], 20)).rejects.toThrow("timed out");
    fakeSpawn((_args, child) => queueMicrotask(() => child.emit("error", new Error("spawn docker ENOENT"))));
    await expect(runDockerImageCommand(["pull", "x"], 1_000)).rejects.toThrow("Docker unavailable: spawn docker ENOENT");
  });
});

describe("security test container runner", () => {
  it("runs exactly the hardened argv and returns the exit code and output", async () => {
    const { calls } = fakeSpawn((_args, child) => queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("ok"));
      child.stderr.emit("data", "warn");
      child.emit("close", 3);
    }));
    await expect(runContainer("x", IMAGE, ["php", "t.php"], 1_000)).resolves.toEqual({ kind: "exited", exitCode: 3, stdout: "ok", stderr: "warn", timedOut: false });
    expect(calls.map(c => c.args)).toEqual([runArgs("x", IMAGE, ["php", "t.php"])]);
    expect(calls[0]!.options).toEqual({ cwd: dockerCwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  });
  it("passes the tool to runArgs and nothing else", async () => {
    const { calls } = fakeSpawn((_args, child) => queueMicrotask(() => child.emit("close", 0)));
    await runContainer("x", IMAGE, ["npm", "test"], 1_000, "npm");
    expect(calls.map(c => c.args)).toEqual([runArgs("x", IMAGE, ["npm", "test"], "npm")]);
  });
  it("refuses unhardened input before starting anything", () => {
    const { calls } = fakeSpawn();
    expect(() => runContainer("x", "php:latest", ["php"], 1_000)).toThrow("immutable");
    expect(() => runContainer("x", IMAGE, ["--privileged"], 1_000)).toThrow("nonempty");
    expect(() => runContainer("x", IMAGE, ["php"], 1_000, "host" as "npm")).toThrow("Unsupported");
    expect(calls).toEqual([]);
  });
  it("kills only the named container on timeout and reports the timeout", async () => {
    const { calls } = fakeSpawn();
    const pending = runContainer("slow", IMAGE, ["php"], 20);
    await vi.waitFor(() => expect(calls.filter(c => c.args[0] === "kill")).toHaveLength(1));
    expect(calls.map(c => c.args)).toEqual([runArgs("slow", IMAGE, ["php"]), ["kill", "slow"]]);
    calls[0]!.child.emit("close", 137);
    await expect(pending).resolves.toEqual({ kind: "exited", exitCode: 137, stdout: "", stderr: "", timedOut: true });
  });
  it("reports a missing Docker as a spawn error, whether spawn throws or emits", async () => {
    fakeSpawn((_args, child) => queueMicrotask(() => child.emit("error", new Error("spawn docker ENOENT"))));
    await expect(runContainer("x", IMAGE, ["php"], 1_000)).resolves.toEqual({ kind: "spawn_error", message: "spawn docker ENOENT" });
    current.spawn = () => { throw new Error("EACCES"); };
    await expect(runContainer("x", IMAGE, ["php"], 1_000)).resolves.toEqual({ kind: "spawn_error", message: "EACCES" });
    current.spawn = () => { throw new Error(""); };
    await expect(runContainer("x", IMAGE, ["php"], 1_000)).resolves.toEqual({ kind: "spawn_error", message: "Error" });
  });
  it("caps captured output", async () => {
    fakeSpawn((_args, child) => queueMicrotask(() => {
      for (let i = 0; i < 3; i++) child.stdout.emit("data", "x".repeat(600_000));
      child.emit("close", 0);
    }));
    const result = await runContainer("x", IMAGE, ["php"], 1_000);
    expect(result.kind === "exited" && result.stdout.length).toBe(1_000_000);
  });
  it("starts every docker process, the timeout kill included, from one empty private folder, not the working directory", async () => {
    const { calls } = fakeSpawn((args, child) => { if (args[0] !== "run") queueMicrotask(() => child.emit("close", 0)); });
    await runDockerImageCommand(["image", "inspect", "x"], 1_000);
    const pending = runContainer("slow", IMAGE, ["php"], 20);
    await vi.waitFor(() => expect(calls.filter(c => c.args[0] === "kill")).toHaveLength(1));
    calls[1]!.child.emit("close", 137);
    await pending;
    expect(calls.map(c => c.args[0])).toEqual(["image", "run", "kill"]);
    expect(new Set(calls.map(c => c.cmd))).toEqual(new Set([DOCKER]));
    const dirs = calls.map(c => (c.options as { cwd?: string }).cwd);
    expect(new Set(dirs)).toEqual(new Set([dockerCwd()]));
    const dir = dockerCwd();
    expect(isAbsolute(dir) && !relative(tmpdir(), dir).startsWith("..")).toBe(true);
    expect(dir).not.toBe(process.cwd());
    expect(existsSync(dir) && readdirSync(dir)).toEqual([]);
  });
  it("start nothing when no docker is found outside the working directory and node_modules", async () => {
    const { calls } = fakeSpawn();
    process.env.PATH = join(bin, "node_modules", ".bin");
    try {
      await expect(runDockerImageCommand(["image", "inspect", "x"], 1_000)).rejects.toThrow("Docker unavailable: docker was not found");
      await expect(runContainer("x", IMAGE, ["php"], 1_000)).resolves.toEqual({ kind: "spawn_error", message: expect.stringContaining("docker was not found") });
      expect(calls).toHaveLength(0);
    } finally { process.env.PATH = bin; }
  });
});

describe("reading memory.swap.max", () => {
  it("reads it in a box with the tool's own flags", async () => {
    const { calls } = fakeSpawn((_args, child) => queueMicrotask(() => { child.stdout.emit("data", "0\n"); child.emit("close", 0); }));
    await expect(readSwapMax("x", IMAGE, "npm")).resolves.toBe("0");
    expect(calls.map(c => c.args)).toEqual([runArgs("x", IMAGE, ["cat", "/sys/fs/cgroup/memory.swap.max"], "npm")]);
  });
  it("keeps a number or max as it is", async () => {
    fakeSpawn((_args, child) => queueMicrotask(() => { child.stdout.emit("data", "max\n"); child.emit("close", 0); }));
    await expect(readSwapMax("x", IMAGE, "npm")).resolves.toBe("max");
  });
  it.each<[string, string, number]>([
    ["no such file", "", 1],
    ["empty", "", 0],
    ["text where a number belongs", "Text from the box\n", 0],
    ["a negative number", "-1\n", 0],
    ["a number with text after it", "0 and more\n", 0],
    ["a value with an exit that is not 0", "0\n", 1],
  ])("is unknown, with no number made up: %s", async (_name, stdout, exit) => {
    fakeSpawn((_args, child) => queueMicrotask(() => { child.stdout.emit("data", stdout); child.emit("close", exit); }));
    await expect(readSwapMax("x", IMAGE, "npm")).resolves.toBe("unknown");
  });
  it("is unknown when Docker cannot start or the arguments are refused, and does not throw", async () => {
    current.spawn = () => { throw new Error("EACCES"); };
    await expect(readSwapMax("x", IMAGE, "npm")).resolves.toBe("unknown");
    const { calls } = fakeSpawn();
    await expect(readSwapMax("x", "php:latest", "npm")).resolves.toBe("unknown");
    expect(calls).toEqual([]);
  });
});

describe("findDocker", () => {
  const root =mkdtempSync(join(tmpdir(), "ludion-find-"));
  const folder = (name: string) => { const dir = join(root, name); mkdirSync(dir, { recursive: true }); return dir; };
  const docker = (dir: string, mode = 0o755) => { const file = join(dir, "docker"); writeFileSync(file, ""); chmodSync(file, mode); return file; };
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it.skipIf(process.platform === "win32")("takes the first absolute PATH folder with an executable docker, skipping empty and relative entries, the working directory, node_modules folders and files that cannot run", () => {
    const project = folder("project"), bins = docker(folder("project/node_modules/.bin")), plain = docker(folder("plain"), 0o644), good = folder("good"), later = folder("later");
    docker(project); docker(later);
    const found = docker(good);
    expect(findDocker(["", "relative/bin", project, join(project, "node_modules", ".bin"), join(root, "plain"), good, later].join(":"), project)).toBe(found);
    expect(findDocker(["", "relative/bin", project, join(project, "node_modules", ".bin"), join(root, "plain")].join(":"), project)).toBeNull();
    expect([bins, plain].every(f => existsSync(f))).toBe(true);
  });
  it.skipIf(process.platform === "win32")("skips PATH folders inside the project (also through a link), Yarn's shim folder, a relative entry and a docker that is not a file", () => {
    const project = folder("p2"), vendor = folder("p2/vendor/bin"), venv = folder("p2/.venv/bin"), dots = folder("p2/..bin"), berry = folder("xfs-1234"), berryDots = folder("xfs-1234/..x"), dirDocker = folder("dirdocker"), outside = folder("outside");
    docker(vendor); docker(venv); docker(dots); docker(berry); docker(berryDots); mkdirSync(join(dirDocker, "docker")); const found = docker(outside);
    const link = join(root, "link-to-vendor"); symlinkSync(vendor, link);
    const rel = relative(process.cwd(), outside);
    expect(findDocker([vendor, venv, dots, link, berry, berryDots, rel, dirDocker, outside].join(":"), root, "linux", project, berry)).toBe(found);
    expect(findDocker([vendor, venv, dots, link, berry, berryDots, rel, dirDocker].join(":"), root, "linux", project, berry)).toBeNull();
    expect(findDocker(vendor, root, "linux", null, undefined)).toBe(join(vendor, "docker"));
  });
  it.skipIf(process.platform === "win32")("finds any plain program name by the same rules, and refuses a name that is a path", () => {
    const project = folder("p3"), inner = folder("p3/node_modules/.bin"), good = folder("good-git");
    for (const dir of [inner, good]) { const file = join(dir, "git"); writeFileSync(file, ""); chmodSync(file, 0o755); }
    expect(findProgram("git", [inner, good].join(":"), root, "linux", project, undefined)).toBe(join(good, "git"));
    expect(() => findProgram("../git")).toThrow("plain program name");
    expect(() => findProgram("git.exe")).toThrow("plain program name");
  });
  it("is told the project root by the security CLI right after it reads --dir", () => {
    const cli = readFileSync(new URL("../../cli/src/security/cli.ts", import.meta.url), "utf8");
    expect(cli).toMatch(/const root = rootPath\(values\.dir!\);\n(?:\s*\/\/.*\n)*\s*useProject\(root\);/);
  });
  it("on Windows, skips the working directory and node_modules folders whatever their case, and a quoted relative entry", () => {
    expect(findDocker('C:\\Project;C:\\Project\\NODE_MODULES\\.bin;"relative"', "c:\\project", "win32")).toBeNull();
  });
});
