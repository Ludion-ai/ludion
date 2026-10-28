// The security commands' only access to Docker. Image commands are limited to pull, build, inspect and cleanup.
// Application tests run from an immutable local image ID with fixed hardening that callers cannot change:
// no network, read-only root, no capabilities, the nobody user, resource limits, no host mounts or forwarded environment.
// This package is a protected path (docs/protected-paths.md): the sandbox flags change only with an independent review.
import { spawn, type ChildProcess } from "node:child_process";

export type ContainerOutcome =
  | { kind: "exited"; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
  | { kind: "spawn_error"; message: string };

/** The package manager whose test runs in the container. Each gets fixed, container-only scratch directories. */
export type Tool = "npm" | "composer" | "maven";

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const OUTPUT_CAP = 1_000_000;
const GRACE_MS = 10_000;

/** Image retrieval/build/inspection only. Containers run only through runContainer. */
export function runDockerImageCommand(args: string[], timeoutMs: number): Promise<string> {
  if (!["pull", "build", "image"].includes(args[0] ?? "") || (args[0] === "image" && !["inspect", "rm"].includes(args[1] ?? ""))) {
    return Promise.reject(new Error("Only Docker image retrieval, build, inspect and cleanup are allowed here."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "", timeout = false;
    const timer = setTimeout(() => { timeout = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-16_384); });
    child.stderr.on("data", chunk => { error = (error + String(chunk)).slice(-16_384); });
    child.on("error", err => { clearTimeout(timer); reject(new Error(`Docker unavailable: ${err.message}`)); });
    child.on("close", code => {
      clearTimeout(timer);
      if (timeout || code !== 0) reject(new Error(timeout ? "Docker image command timed out." : `Docker image command failed (${code}): ${error.slice(-1500)}`));
      else resolve(output.trim());
    });
  });
}

/** `docker run` argv for one application test. The hardening flags are literals here, not options. */
export function runArgs(name: string, image: string, command: readonly string[], tool?: Tool): string[] {
  if (typeof name !== "string" || !CONTAINER_NAME.test(name)) throw new Error(`Container name ${JSON.stringify(name)} is not a single safe token.`);
  if (typeof image !== "string" || !/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Security tests require an immutable local image ID.");
  if (!Array.isArray(command) || !command.length || !command.every(a => typeof a === "string" && a.length > 0 && a.length <= 2000 && !a.includes("\0")) || command[0]!.startsWith("-")) throw new Error("Expected a nonempty application test argv.");
  if (tool !== undefined && tool !== "npm" && tool !== "composer" && tool !== "maven") throw new Error("Unsupported security test tool.");
  const args = ["run", "--rm", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534", "--cpus", "1", "--memory", "512m", "--pids-limit", "256", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m"];
  // Fixed scratch directories the package manager's test tools write to, inside the container only. No host mounts.
  if (tool === "npm") args.push("--tmpfs", "/app/node_modules/.vite:rw,noexec,nosuid,nodev,size=32m,mode=1777", "--tmpfs", "/app/node_modules/.vite-temp:rw,noexec,nosuid,nodev,size=32m,mode=1777");
  if (tool === "composer") args.push("--tmpfs", "/app/.phpunit.cache:rw,noexec,nosuid,nodev,size=32m,mode=1777");
  if (tool === "maven") args.push("--tmpfs", "/app/target:rw,noexec,nosuid,nodev,size=256m,mode=1777");
  // A fixed value, not the host's: the root is read-only, so tools that write under HOME need the tmpfs.
  if (tool) args.push("--env", "HOME=/tmp");
  args.push("--entrypoint", command[0]!, image, ...command.slice(1));
  return args;
}

/**
 * Runs one application test container, always with the runArgs hardening: there is no way to pass other docker
 * arguments. On timeout, kills only that container name, then the docker client after a grace period.
 */
export function runContainer(name: string, image: string, command: readonly string[], timeoutMs: number, tool?: Tool): Promise<ContainerOutcome> {
  const args = runArgs(name, image, command, tool);
  return new Promise(resolve => {
    let child: ChildProcess;
    try {
      child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ kind: "spawn_error", message: err instanceof Error && err.message ? err.message : String(err) });
      return;
    }
    let stdout = "", stderr = "", timedOut = false, settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      try { spawn("docker", ["kill", name], { stdio: "ignore" }).on("error", () => {}); } catch { /* the grace kill below still runs */ }
      grace = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, GRACE_MS);
    }, timeoutMs);
    const finish = (result: ContainerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      resolve(result);
    };
    // Output is kept for failure messages only; it never decides the outcome.
    const append = (current: string, chunk: unknown) => current.length >= OUTPUT_CAP ? current : (current + String(chunk)).slice(0, OUTPUT_CAP);
    child.stdout?.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", chunk => { stderr = append(stderr, chunk); });
    child.on("error", err => finish({ kind: "spawn_error", message: err.message }));
    child.on("close", exitCode => finish({ kind: "exited", exitCode, stdout, stderr, timedOut }));
  });
}
