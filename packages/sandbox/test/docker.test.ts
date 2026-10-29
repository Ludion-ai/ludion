import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { dockerCwd, findDocker, runArgs, runContainer, runDockerImageCommand } from "../src/docker.ts";

// The module takes no spawn parameter (a caller could otherwise rewrite the argv), so tests replace node's spawn.
const current = vi.hoisted(() => ({ spawn: undefined as unknown as (cmd: string, args: readonly string[], options: unknown) => unknown }));
vi.mock("node:child_process", () => ({ spawn: (cmd: string, args: readonly string[], options: unknown) => current.spawn(cmd, args, options) }));

const IMAGE = `sha256:${"a".repeat(64)}`;
const HARDENED = [
  "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534",
  "--cpus", "1", "--memory", "512m", "--pids-limit", "256", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
];

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
      "run", "--rm", "--name", "n", ...HARDENED, "--tmpfs", `/app/node_modules/.vite:${scratch}`, "--tmpfs", `/app/node_modules/.vite-temp:${scratch}`,
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

describe("findDocker", () => {
  const root = mkdtempSync(join(tmpdir(), "ludion-find-"));
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
  it("on Windows, skips the working directory and node_modules folders whatever their case, and a quoted relative entry", () => {
    expect(findDocker('C:\\Project;C:\\Project\\NODE_MODULES\\.bin;"relative"', "c:\\project", "win32")).toBeNull();
  });
});
