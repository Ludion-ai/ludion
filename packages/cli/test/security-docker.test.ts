import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { runArgs, runContainer, runDockerImageCommand } from "../src/security/docker.ts";

const IMAGE = `sha256:${"a".repeat(64)}`;

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.emit("close", null); return true; };
  return child;
}
function fakeSpawn(onSpawn: (args: readonly string[], child: FakeChild) => void = () => {}) {
  const calls: { args: readonly string[]; options: unknown; child: FakeChild }[] = [];
  const spawn = ((_cmd: string, args: readonly string[], options: unknown) => {
    const child = fakeChild();
    calls.push({ args, options, child });
    onSpawn(args, child);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawn, calls };
}

describe("security test container arguments", () => {
  it("are the fixed hardened argv, with the test argv only after the image", () => {
    expect(runArgs("ludion-security-1-candidate-test", IMAGE, ["php", "tests/smoke.php"])).toEqual([
      "run", "--rm", "--name", "ludion-security-1-candidate-test", "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--user", "65534:65534", "--cpus", "1", "--memory", "512m", "--pids-limit", "256",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--entrypoint", "php", IMAGE, "tests/smoke.php",
    ]);
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
    for (const args of [["run", "php"], ["exec", "x", "sh"], ["image", "ls"], ["image", "save", "php"], ["container", "rm", "x"], []]) {
      await expect(runDockerImageCommand(args, 1_000)).rejects.toThrow("Only Docker image retrieval");
    }
  });
});

describe("security test container runner", () => {
  it("returns the exit code and output without a shell", async () => {
    const { spawn, calls } = fakeSpawn((_args, child) => queueMicrotask(() => {
      child.stdout.emit("data", Buffer.from("ok"));
      child.stderr.emit("data", "warn");
      child.emit("close", 3);
    }));
    await expect(runContainer(["run", "x"], "x", 1_000, spawn)).resolves.toEqual({ kind: "exited", exitCode: 3, stdout: "ok", stderr: "warn", timedOut: false });
    expect(calls[0]!.options).toEqual({ stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  });
  it("kills only the named container on timeout and reports the timeout", async () => {
    const { spawn, calls } = fakeSpawn();
    const pending = runContainer(["run", "--name", "slow"], "slow", 20, spawn);
    await vi.waitFor(() => expect(calls.filter(c => c.args[0] === "kill")).toHaveLength(1));
    expect(calls.map(c => c.args)).toEqual([["run", "--name", "slow"], ["kill", "slow"]]);
    calls[0]!.child.emit("close", 137);
    await expect(pending).resolves.toEqual({ kind: "exited", exitCode: 137, stdout: "", stderr: "", timedOut: true });
  });
  it("reports a missing Docker as a spawn error, whether spawn throws or emits", async () => {
    const emits = fakeSpawn((_args, child) => queueMicrotask(() => child.emit("error", new Error("spawn docker ENOENT"))));
    await expect(runContainer(["run"], "x", 1_000, emits.spawn)).resolves.toEqual({ kind: "spawn_error", message: "spawn docker ENOENT" });
    const throws = (() => { throw new Error("EACCES"); }) as unknown as typeof import("node:child_process").spawn;
    await expect(runContainer(["run"], "x", 1_000, throws)).resolves.toEqual({ kind: "spawn_error", message: "EACCES" });
  });
  it("caps captured output", async () => {
    const { spawn } = fakeSpawn((_args, child) => queueMicrotask(() => {
      for (let i = 0; i < 3; i++) child.stdout.emit("data", "x".repeat(600_000));
      child.emit("close", 0);
    }));
    const result = await runContainer(["run"], "x", 1_000, spawn);
    expect(result.kind === "exited" && result.stdout.length).toBe(1_000_000);
  });
});
