// Program executor. Isolation boundary: a capability program runs only inside Docker,
// with the network off, a read-only root, all capabilities dropped, and a non-root user.
// The executor copies the caller's work tree into its own fresh private temp directory
// (lstat on every entry, symlinks and non-regular files refused, nothing followed) and
// mounts only that snapshot, read-only. Only existing snapshot files matched by
// program.effects.writes are bind-mounted read-write over it. New files are not supported.
// The executor evaluates the guard itself, on the snapshot it will mount. A guard result
// from the caller is never authority. Anything other than a well-formed applicable result
// (including a guard that throws or returns nothing) returns not_executed and does not start
// Docker. The snapshot is removed afterwards and nothing is written back to the caller's tree.
// This module never calls a model.
// Verification is a separate fixed verifier step (step 5). This module never issues verified.
// Program stdout is stored as a tail and is never read as a success or verification claim.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { anyGlob } from "./glob.ts";
import { verifyRecord } from "./hash.ts";
import { nodeMajor } from "./node-version.ts";
import { evaluateGuard, type GuardInput } from "./guard.ts";
import { CapabilityRecord, effectiveProtectedPaths, FIXED_PROTECTED_GLOBS, GuardResult, globsMayOverlap, imageDigest, PinnedImage } from "./schema.ts";
import type { GuardResultT } from "./schema.ts";

export type DockerRunRequest = { args: readonly string[]; containerName: string; timeoutMs: number };

export type DockerRunOutcome =
  | { kind: "exited"; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }
  | { kind: "spawn_error"; message: string };

export type DockerRunner = (req: DockerRunRequest) => Promise<DockerRunOutcome>;

/** Vitest, Vite, Node, and the digest-pinned image this executor will run. */
export const PINNED_VERSION_SET = {
  node_major: "24",
  vitest: "4.0.0",
  vite: "7.1.11",
  image: "node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205",
} as const;

/**
 * What the caller observed before the repair. The fixed verifier (step 5) supplies this.
 * This module copies it onto the result and does not judge the repair from it.
 */
export type PreRepairEvidence =
  | { ran: true; exit_code: number | null; failed_tests: string[]; passed_tests: string[]; detail?: string }
  | { ran: false; reason: string };

export type ExecuteProgramInput = {
  record: unknown;
  /**
   * Ignored. Kept so older callers still type-check. The executor evaluates the guard itself on
   * its own snapshot of workDir; a caller-supplied result can never make the program run.
   */
  guard?: unknown;
  /** Contract id the caller intends to apply. Passed to the guard; a missing id is not applicable. */
  contract_id?: string;
  /**
   * Absolute path of the recipient work copy. Caller-owned and never mounted or modified.
   * Must be a real directory inside the runner temp roots. The executor copies it into a private
   * snapshot (skipping node_modules and .git directories) and runs on that copy only.
   */
  workDir: string;
  /** Lockfile versions the guard resolved for the recipient. */
  resolved_versions: Record<string, string>;
  /** Recipient Node version, `vX.Y.Z` or `X.Y.Z`. */
  node_version: string;
  runner?: DockerRunner;
  containerName?: string;
  /** Clock for wall_ms. Defaults to performance.now. */
  now?: () => number;
  /**
   * Called after the snapshot, the guard gate and the version check, and before the program container.
   * Supplied by the fixed verifier (step 5). Omitted means this run has no pre-repair sample.
   */
  preRepair?: () => Promise<PreRepairEvidence>;
  /** When true, a missing preRepair rejects with pre_repair_unavailable. Default false. */
  require_pre_repair?: boolean;
};

/** Lexical evidence for step 5. Not a verdict. */
export type RedFlag = "tests_removed" | "skip_only_todo_added" | "file_emptied";

export type ExecutionEvidence = {
  exit_code: number | null;
  timed_out: boolean;
  wall_ms: number;
  image: string;
  image_digest: string;
  versions: { node: "24"; vitest: "4.0.0"; vite: "7.1.11" };
  files: Array<{ path: string; before_sha256: string; after_sha256: string; before_bytes: number; after_bytes: number; changed: boolean }>;
  /** Changed files only. Each side is capped at 64 KiB. */
  diff: Array<{ path: string; before: string; after: string; truncated: boolean }>;
  no_op: boolean;
  red_flags: RedFlag[];
  stdout_tail: string;
  stderr_tail: string;
};

export type ProgramExecution =
  | {
      outcome: "not_executed";
      /** guard_failed: the guard threw, or returned null, undefined, or a value that is not a GuardResult. */
      reason: "guard_not_applicable" | "guard_failed";
      /** Status of the executor's own guard evaluation. Null when the guard failed. */
      guard_status: GuardResultT["status"] | null;
      /** The executor's own guard result on the snapshot. Null when the guard failed. */
      guard: GuardResultT | null;
      detail: string;
      docker_invoked: false;
      pre_repair: PreRepairEvidence | null;
      wall_ms: number;
      model_calls: { count: 0 };
    }
  | {
      outcome: "rejected";
      /** unsafe_work_tree: the snapshot copy refused a symlink, a non-regular file, a hardlinked write target, a size cap, or a concurrent change. */
      reason:
        | "invalid_record"
        | "unsafe_write_target"
        | "invalid_work_dir"
        | "unsafe_work_tree"
        | "invalid_program"
        | "version_set_mismatch"
        | "pre_repair_not_failing"
        | "pre_repair_unavailable";
      detail: string;
      docker_invoked: false;
      pre_repair: PreRepairEvidence | null;
      wall_ms: number;
      model_calls: { count: 0 };
    }
  | { outcome: "environment_unavailable"; detail: string; docker_invoked: true; pre_repair: PreRepairEvidence | null; wall_ms: number; model_calls: { count: 0 } }
  | {
      outcome: "executed";
      /** Container process exit status, not verification. */
      status: "ok" | "failed" | "timeout";
      /** The executor's own applicable guard result, evaluated on the mounted snapshot. */
      guard: GuardResultT;
      /** Relative posix paths that were mounted read-write. */
      writable_files: string[];
      /** Subset of writable_files whose bytes changed. */
      changed_files: string[];
      docker_args: string[];
      evidence: ExecutionEvidence;
      pre_repair: PreRepairEvidence | null;
      wall_ms: number;
      model_calls: { count: 0 };
    };

const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const OUTPUT_CAP = 1_000_000;
const TAIL_CAP = 4_000;
const GRACE_MS = 10_000;
const WRITABLE_CAP = 256;
const DIFF_CAP = 64 * 1024;
const SNAPSHOT_FILE_CAP = 10_000;
const SNAPSHOT_BYTE_CAP = 64 * 1024 * 1024;
const SNAPSHOT_DEPTH_CAP = 64;
/** Directory names the snapshot does not copy, at any depth. They are skipped by name and never followed. */
const SNAPSHOT_SKIP_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git"]);
const MODEL_CALLS = { count: 0 } as const;
const EMPTY_SHA256 = `sha256:${createHash("sha256").update(Buffer.alloc(0)).digest("hex")}`;
/** `\b(it|test)(\.each)?\s*\(` — `.skip` between the name and `(` does not match. */
const TEST_CALL_RE = /\b(?:it|test)(?:\.each)?\s*\(/g;
/** `.skip` does not consume `.skipIf`: the word boundary fails between p and I. */
const SKIP_DOT_RE = /\.(?:skip|only|todo|skipIf|runIf)\b/g;
const SKIP_ALIAS_RE = /\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/g;

type SpawnFn = typeof nodeSpawn;

/** `Omit` on a union keeps only shared keys. This applies Omit to each result variant. */
type DropClock<T> = T extends unknown ? Omit<T, "wall_ms" | "model_calls" | "pre_repair"> : never;
type ExecutionCore = DropClock<ProgramExecution>;

/**
 * Numeric uid:gid for --user. The host uid and gid are used on POSIX when both are non-zero.
 * Root (0) is never used. Windows has no uid, and a root host is not passed through: both fall back to 1000:1000.
 */
export function resolveSandboxUser(uid: number | undefined, gid: number | undefined): string {
  if (typeof uid === "number" && typeof gid === "number" && Number.isInteger(uid) && Number.isInteger(gid) && uid > 0 && gid > 0) {
    return `${uid}:${gid}`;
  }
  return "1000:1000";
}

/**
 * Lexical form of a bind-mount source. A comma or an extra colon would be read by Docker as mount
 * options. A Windows drive prefix is rewritten to `/c/...` so the value that is actually passed has no colon.
 */
export function toDockerMountSource(hostPath: string): string {
  if (typeof hostPath !== "string" || hostPath.length === 0 || hostPath.length > 4096) {
    throw new Error("Mount source must be an absolute path.");
  }
  if (/[\0\r\n]/.test(hostPath) || hostPath.includes(",")) {
    throw new Error("Mount source contains a character that would change the mount.");
  }
  let source = hostPath;
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(hostPath);
  if (drive) {
    const letter = drive[1];
    const rest = drive[2];
    if (letter === undefined || rest === undefined || rest.includes(":")) {
      throw new Error("Mount source contains a character that would change the mount.");
    }
    source = `/${letter.toLowerCase()}/${rest.replace(/\\/g, "/")}`;
  } else if (hostPath.includes(":") || hostPath.includes("\\") || !hostPath.startsWith("/")) {
    throw new Error(hostPath.includes(":") || hostPath.includes("\\")
      ? "Mount source contains a character that would change the mount."
      : "Mount source must be an absolute path.");
  }
  const parts = source.split("/");
  if (!source.startsWith("/") || parts.slice(1).some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Mount source must be an absolute path without '.' or '..'.");
  }
  if (/[,:]/.test(source)) throw new Error("Mount source contains a character that would change the mount.");
  const spec = `${source}:/w`;
  if (!spec.endsWith(":/w") || spec.slice(0, -3).includes(":") || spec.includes(",")) {
    throw new Error("Mount source contains a character that would change the mount.");
  }
  return source;
}

export type ProgramDockerArgsOpts = {
  containerName: string;
  image: string;
  workDirSource: string;
  programDirSource: string;
  entry: string;
  writableFiles: readonly string[];
  /** Defaults to resolveSandboxUser(process uid, process gid). */
  user?: string;
};

/**
 * `docker run` arguments for a capability program. Hardening flags are unconditional.
 * Throws on a bad container name, an unpinned image, an unsafe entry or writable path, or a mount source
 * that still contains a comma, a colon, or a newline after the drive-letter rewrite.
 */
export function buildProgramDockerArgs(opts: ProgramDockerArgsOpts): string[] {
  if (!CONTAINER_NAME.test(opts.containerName)) {
    throw new Error(`Container name ${JSON.stringify(opts.containerName)} is not a single safe token.`);
  }
  if (!PinnedImage.safeParse(opts.image).success) {
    throw new Error(`Image ${JSON.stringify(opts.image)} is not pinned by digest.`);
  }
  const user = opts.user ?? resolveSandboxUser(hostUid(), hostGid());
  if (!/^[1-9][0-9]*:[1-9][0-9]*$/.test(user)) throw new Error("Sandbox user must be a non-root numeric uid:gid.");
  if (!isSafeRel(opts.entry)) throw new Error(`Entry ${JSON.stringify(opts.entry)} is not a safe relative path.`);
  const workSource = toDockerMountSource(opts.workDirSource);
  const programSource = toDockerMountSource(opts.programDirSource);
  const writable = [...opts.writableFiles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < writable.length; i++) {
    const rel = writable[i];
    if (rel === undefined || !isSafeRel(rel)) throw new Error(`Writable path ${JSON.stringify(rel)} is not a safe relative path.`);
    if (i > 0 && rel === writable[i - 1]) throw new Error(`Duplicate writable file ${JSON.stringify(rel)}.`);
  }

  const args = [
    "run", "--rm", "--name", opts.containerName,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--read-only",
    "--memory", "512m",
    "--cpus", "1",
    "--pids-limit", "256",
    "--user", user,
    "--network", "none",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "-v", `${workSource}:/work:ro`,
  ];
  for (const rel of writable) {
    const host = `${workSource}/${rel}`;
    if (/[,:\0\r\n]/.test(host)) throw new Error(`Writable mount ${JSON.stringify(rel)} contains a character that would change the mount.`);
    args.push("-v", `${host}:/work/${rel}:rw`);
  }
  args.push(
    "-v", `${programSource}:/program:ro`,
    "-w", "/work",
    "-e", "HOME=/tmp",
    opts.image,
    "node", `/program/${opts.entry}`,
  );
  return args;
}

/** Reject absolute globs, `..`, backslashes, dot-leading segments, and overlap with the fixed protected denylist. */
export function validateWriteGlobs(globs: readonly string[]): { ok: true } | { ok: false; detail: string } {
  return checkWriteGlobs(globs, FIXED_PROTECTED_GLOBS);
}

/**
 * Files under workDir that match a write glob.
 * The walk uses lstat and does not follow symlinks, descend into symlinked directories,
 * or descend into dot-directories or node_modules.
 * New-file creation is not supported: only existing regular files are returned, and only those are bind-mounted read-write.
 */
export function resolveWritableFiles(workDir: string, globs: readonly string[]): { ok: true; files: string[] } | { ok: false; detail: string } {
  let rootStat: Stats;
  try {
    rootStat = lstatSync(workDir);
  } catch {
    return { ok: false, detail: "work directory is not readable" };
  }
  if (rootStat.isSymbolicLink()) return { ok: false, detail: "symlink out: work directory" };
  if (!rootStat.isDirectory()) return { ok: false, detail: "work directory is not a directory" };
  let rootReal: string;
  try {
    rootReal = realpathSync(workDir);
  } catch {
    return { ok: false, detail: "work directory realpath failed" };
  }
  const files: string[] = [];
  const problem = walkWritable(workDir, "", rootReal, globs, files);
  if (problem !== undefined) return { ok: false, detail: problem };
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { ok: true, files };
}

/** Spawn `docker`. On timeout, kill only that container name, then the child after a 10s grace. */
export function createDockerRunner(deps?: { spawn?: SpawnFn }): DockerRunner {
  const spawnFn: SpawnFn = deps?.spawn ?? nodeSpawn;
  return (req) => runDocker(spawnFn, req);
}

export async function executeProgram(input: ExecuteProgramInput): Promise<ProgramExecution> {
  const now = input.now ?? (() => performance.now());
  const started = now();
  let preRepairEvidence: PreRepairEvidence | null = null;
  // Spread of a union widens to the shared keys, so the non-executed return is asserted back.
  // now() runs once here, matching the single call at entry, so wall_ms has one clock.
  const finish = (body: ExecutionCore): ProgramExecution => {
    const wall_ms = Math.max(0, Math.round(now() - started));
    if (body.outcome === "executed") {
      return {
        outcome: "executed",
        status: body.status,
        guard: body.guard,
        writable_files: body.writable_files,
        changed_files: body.changed_files,
        docker_args: body.docker_args,
        evidence: { ...body.evidence, wall_ms },
        pre_repair: preRepairEvidence,
        wall_ms,
        model_calls: MODEL_CALLS,
      };
    }
    return { ...body, wall_ms, model_calls: MODEL_CALLS, pre_repair: preRepairEvidence } as ProgramExecution;
  };

  // input.guard is deliberately never read. The only guard result that counts is the one below.
  const parsed = CapabilityRecord.safeParse(input.record);
  if (!parsed.success) {
    return finish({ outcome: "rejected", reason: "invalid_record", detail: clip(parsed.error.issues[0]?.message ?? "record did not parse"), docker_invoked: false });
  }
  let integrity: ReturnType<typeof verifyRecord>;
  try {
    integrity = verifyRecord(parsed.data);
  } catch (err) {
    return finish({ outcome: "rejected", reason: "invalid_record", detail: clip(errorMessage(err)), docker_invoked: false });
  }
  if (!("ok" in integrity)) {
    return finish({ outcome: "rejected", reason: "invalid_record", detail: clip(integrity.detail), docker_invoked: false });
  }
  const record = parsed.data;
  const program = record.artifact.program;

  // The pinned version set is a host gate. A mismatch does not start Docker.
  const versions = versionMismatchDetail(
    record.artifact.guard.runtime.node_major,
    record.artifact.dependencies.image,
    input.resolved_versions,
    input.node_version,
  );
  if (versions !== undefined) {
    return finish({ outcome: "rejected", reason: "version_set_mismatch", detail: clip(versions), docker_invoked: false });
  }

  const writes = checkWriteGlobs(program.effects.writes, effectiveProtectedPaths(record.artifact.verifier));
  if (!writes.ok) return finish({ outcome: "rejected", reason: "unsafe_write_target", detail: writes.detail, docker_invoked: false });

  const work = validateWorkDir(input.workDir);
  if (!work.ok) return finish({ outcome: "rejected", reason: "invalid_work_dir", detail: work.detail, docker_invoked: false });

  // Step 1. Private snapshot. Everything after this reads and mounts only the snapshot.
  const snapshotDir = mkdtempSync(join(tmpdir(), "ludion-snapshot-"));
  try {
    const snap = takeSnapshot(work.real, snapshotDir, program.effects.writes);
    if (!snap.ok) return finish({ outcome: "rejected", reason: "unsafe_work_tree", detail: clip(snap.detail), docker_invoked: false });

    // Step 2. The executor's own guard, on the exact bytes it copied. Fail-closed on anything but applicable.
    const gate = runGuard(record, {
      ...(input.contract_id !== undefined ? { contract_id: input.contract_id } : {}),
      files: snap.files,
      resolved_versions: input.resolved_versions,
      node_version: input.node_version,
    });
    if (!gate.ok) {
      return finish({ outcome: "not_executed", reason: "guard_failed", guard_status: null, guard: null, detail: clip(gate.detail), docker_invoked: false });
    }
    if (gate.guard.status !== "applicable") {
      return finish({
        outcome: "not_executed",
        reason: "guard_not_applicable",
        guard_status: gate.guard.status,
        guard: gate.guard,
        detail: clip(`guard status ${gate.guard.status}: ${gate.guard.reason}`),
        docker_invoked: false,
      });
    }
    const guard = gate.guard;

    const writable = resolveWritableFiles(snap.real, program.effects.writes);
    if (!writable.ok) return finish({ outcome: "rejected", reason: "unsafe_write_target", detail: writable.detail, docker_invoked: false });

    const containerName = input.containerName ?? `ludion-program-${randomUUID()}`;
    if (!CONTAINER_NAME.test(containerName)) {
      return finish({ outcome: "rejected", reason: "invalid_program", detail: `Container name ${JSON.stringify(containerName)} is not a single safe token.`, docker_invoked: false });
    }
    if (!isSafeRel(program.entry) || !Object.hasOwn(program.files, program.entry)) {
      return finish({ outcome: "rejected", reason: "invalid_program", detail: "program entry is not one of program.files", docker_invoked: false });
    }
    for (const key of Object.keys(program.files)) {
      if (!isSafeRel(key)) {
        return finish({ outcome: "rejected", reason: "invalid_program", detail: `program file ${JSON.stringify(key)} is not a safe relative path`, docker_invoked: false });
      }
    }

    // Before-hashes come from the snapshot, before any caller code (preRepair) runs.
    const before = readSnapshots(snap.real, writable.files);
    if (before === undefined) {
      return finish({ outcome: "rejected", reason: "unsafe_write_target", detail: "a writable file could not be hashed", docker_invoked: false });
    }

    // Step 3. Pre-repair evidence is supplied by the caller. It runs after every host gate and before the container.
    const pre = await takePreRepair(input);
    preRepairEvidence = pre.evidence;
    if (!pre.ok) {
      return finish({ outcome: "rejected", reason: pre.reason, detail: pre.detail, docker_invoked: false });
    }

    const programDir = mkdtempSync(join(tmpdir(), "ludion-program-"));
    try {
      try {
        writeProgramFiles(programDir, program.files);
      } catch (err) {
        return finish({ outcome: "rejected", reason: "invalid_program", detail: clip(errorMessage(err)), docker_invoked: false });
      }
      let args: string[];
      try {
        const programSource = toDockerMountSource(realpathSync(programDir));
        args = buildProgramDockerArgs({
          containerName,
          image: record.artifact.dependencies.image,
          workDirSource: snap.real,
          programDirSource: programSource,
          entry: program.entry,
          writableFiles: writable.files,
        });
      } catch (err) {
        return finish({ outcome: "rejected", reason: "invalid_program", detail: clip(errorMessage(err)), docker_invoked: false });
      }
      const dockerArgs = [...args];
      const runner = input.runner ?? createDockerRunner();
      let outcome: DockerRunOutcome;
      try {
        outcome = await runner({ args, containerName, timeoutMs: program.timeout_ms });
      } catch (err) {
        return finish({ outcome: "environment_unavailable", detail: clip(errorMessage(err)), docker_invoked: true });
      }
      const compared = compareSnapshots(snap.real, before);
      return finish(mapOutcome(outcome, {
        guard,
        writableFiles: writable.files,
        compared,
        image: record.artifact.dependencies.image,
        dockerArgs,
      }));
    } finally {
      rmSync(programDir, { recursive: true, force: true });
    }
  } finally {
    // Only the directory this call created.
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

/**
 * The executor's guard call. A throw, null, undefined, or a value that is not a GuardResult is a
 * failure, never a pass. Only a schema-valid result is returned.
 */
function runGuard(record: unknown, guardInput: GuardInput): { ok: true; guard: GuardResultT } | { ok: false; detail: string } {
  let raw: unknown;
  try {
    raw = evaluateGuard(record, guardInput);
  } catch (err) {
    return { ok: false, detail: `guard evaluation threw: ${errorMessage(err)}` };
  }
  if (raw === null) return { ok: false, detail: "guard evaluation returned null" };
  if (raw === undefined) return { ok: false, detail: "guard evaluation returned undefined" };
  const checked = GuardResult.safeParse(raw);
  if (!checked.success) return { ok: false, detail: "guard evaluation returned a value that is not a guard result" };
  return { ok: true, guard: checked.data };
}

type SnapshotResult = { ok: true; real: string; files: Record<string, string> } | { ok: false; detail: string };

type SnapshotState = {
  srcRoot: string;
  writeGlobs: readonly string[];
  privateModes: boolean;
  files: Record<string, string>;
  count: number;
  bytes: number;
};

function sameNode(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Copy srcRoot into the fresh, empty dstRoot. lstat on every entry. A symlink or junction anywhere
 * (other than one named node_modules or .git, which is skipped without being followed), a
 * non-regular file, a hardlinked (nlink > 1) write target, a file that changes identity between
 * lstat and open, or a directory that changes during the walk refuses the whole snapshot.
 * Returns the snapshot's realpath and the copied text keyed by posix path, for the guard.
 */
function takeSnapshot(srcRoot: string, dstRoot: string, writeGlobs: readonly string[]): SnapshotResult {
  let real: string;
  try {
    real = realpathSync(dstRoot);
  } catch (err) {
    return { ok: false, detail: `snapshot directory realpath failed: ${errorMessage(err)}` };
  }
  // A root host runs the container as 1000:1000, which then needs to read the copy. Otherwise the
  // container runs as this uid and the snapshot stays private to it. Windows ignores modes.
  const uid = hostUid();
  const privateModes = !(typeof uid === "number" && uid === 0);
  const state: SnapshotState = { srcRoot, writeGlobs, privateModes, files: {}, count: 0, bytes: 0 };
  try {
    chmodSync(real, privateModes ? 0o700 : 0o755);
    const problem = copyDir(srcRoot, real, "", 0, state);
    if (problem !== undefined) return { ok: false, detail: problem };
  } catch (err) {
    return { ok: false, detail: `snapshot failed: ${errorMessage(err)}` };
  }
  return { ok: true, real, files: state.files };
}

function copyDir(srcDir: string, dstDir: string, rel: string, depth: number, state: SnapshotState): string | undefined {
  const label = rel.length === 0 ? "." : rel;
  let dirBefore: Stats;
  try {
    dirBefore = lstatSync(srcDir);
  } catch (err) {
    return `cannot lstat ${label}: ${errorMessage(err)}`;
  }
  if (dirBefore.isSymbolicLink() || !dirBefore.isDirectory()) return `not a real directory: ${label}`;
  let names: string[];
  try {
    names = readdirSync(srcDir);
  } catch (err) {
    return `cannot read ${label}: ${errorMessage(err)}`;
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const childRel = rel.length === 0 ? name : `${rel}/${name}`;
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    let st: Stats;
    try {
      st = lstatSync(src);
    } catch (err) {
      return `cannot lstat ${childRel}: ${errorMessage(err)}`;
    }
    if (SNAPSHOT_SKIP_DIRS.has(name) && (st.isDirectory() || st.isSymbolicLink())) continue;
    if (st.isSymbolicLink()) return `symlink in work tree: ${childRel}`;
    if (st.isDirectory()) {
      if (depth + 1 > SNAPSHOT_DEPTH_CAP) return `work tree deeper than ${SNAPSHOT_DEPTH_CAP} levels at ${childRel}`;
      mkdirSync(dst, { mode: state.privateModes ? 0o700 : 0o755 });
      const nested = copyDir(src, dst, childRel, depth + 1, state);
      if (nested !== undefined) return nested;
      continue;
    }
    if (!st.isFile()) return `not a regular file: ${childRel}`;
    const writeTarget = anyGlob(state.writeGlobs, childRel);
    if (writeTarget && st.nlink > 1) return `hardlinked write target (nlink ${st.nlink}): ${childRel}`;
    state.count += 1;
    if (state.count > SNAPSHOT_FILE_CAP) return `work tree has more than ${SNAPSHOT_FILE_CAP} files`;
    state.bytes += st.size;
    if (state.bytes > SNAPSHOT_BYTE_CAP) return `work tree is larger than ${SNAPSHOT_BYTE_CAP} bytes`;
    const read = readRegularNoFollow(src, st, childRel, state.srcRoot);
    if (!read.ok) return read.detail;
    const mode = state.privateModes ? 0o600 : writeTarget ? 0o666 : 0o644;
    writeFileSync(dst, read.buf, { flag: "wx", mode });
    // writeFileSync's mode is masked by umask; set it explicitly for the root-host case.
    if (!state.privateModes) chmodSync(dst, mode);
    state.files[childRel] = read.buf.toString("utf8");
  }
  let dirAfter: Stats;
  try {
    dirAfter = lstatSync(srcDir);
  } catch (err) {
    return `cannot lstat ${label}: ${errorMessage(err)}`;
  }
  if (dirAfter.isSymbolicLink() || !dirAfter.isDirectory() || !sameNode(dirBefore, dirAfter)) {
    return `work tree changed during the snapshot: ${label}`;
  }
  return undefined;
}

/**
 * Read one regular file without following a symlink. O_NOFOLLOW where the platform has it; on every
 * platform the open descriptor must be the same file (dev, ino, size) that lstat saw, and the
 * path's realpath must still be the expected path under the work root.
 */
function readRegularNoFollow(path: string, seen: Stats, rel: string, srcRoot: string): { ok: true; buf: Buffer } | { ok: false; detail: string } {
  const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  let fd: number;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | noFollow);
  } catch (err) {
    return { ok: false, detail: `cannot open ${rel}: ${errorMessage(err)}` };
  }
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || !sameNode(opened, seen) || opened.size !== seen.size) {
      return { ok: false, detail: `file changed between lstat and open: ${rel}` };
    }
    let real: string;
    try {
      real = realpathSync(path);
    } catch (err) {
      return { ok: false, detail: `realpath failed for ${rel}: ${errorMessage(err)}` };
    }
    if (!samePath(real, join(srcRoot, ...rel.split("/")))) return { ok: false, detail: `path escaped the work directory: ${rel}` };
    const buf = readFileSync(fd);
    if (buf.byteLength !== seen.size) return { ok: false, detail: `file changed while it was read: ${rel}` };
    return { ok: true, buf };
  } finally {
    closeSync(fd);
  }
}

function hostUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function hostGid(): number | undefined {
  return typeof process.getgid === "function" ? process.getgid() : undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message.length > 0 ? err.message : String(err);
}

function clip(detail: string): string {
  return detail.slice(0, 500);
}

function tail(text: string): string {
  return text.length <= TAIL_CAP ? text : text.slice(-TAIL_CAP);
}

/** Relative path safe to place under /work or /program: no absolute, drive, `..`, dot segment, or mount metacharacter. */
function isSafeRel(p: string): boolean {
  if (typeof p !== "string" || p.length === 0 || p.length > 260) return false;
  if (!p.isWellFormed() || p !== p.normalize("NFC")) return false;
  if (p.startsWith("/") || p.startsWith("\\") || /^[A-Za-z]:/.test(p)) return false;
  if (p.includes("\\") || p.includes(",") || p.includes(":") || p.includes("%")) return false;
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  const segs = p.split("/");
  for (const s of segs) {
    if (s === "" || s === "." || s === ".." || s.startsWith(".") || s.endsWith(".")) return false;
  }
  return true;
}

function unsafeGlobDetail(glob: string): string | undefined {
  if (glob.length === 0) return "write glob is empty";
  if (/[\u0000-\u001f\u007f]/.test(glob)) return `write glob ${JSON.stringify(glob)} contains a control character`;
  if (glob.startsWith("/") || glob.startsWith("\\") || /^[A-Za-z]:/.test(glob)) {
    return `write glob ${JSON.stringify(glob)} is absolute`;
  }
  if (glob.includes("\\")) return `write glob ${JSON.stringify(glob)} contains a backslash`;
  const segs = glob.split("/");
  if (segs.includes("..")) return `write glob ${JSON.stringify(glob)} contains a '..' segment`;
  if (segs.some((s) => s.startsWith("."))) return `write glob ${JSON.stringify(glob)} contains a dot-leading segment`;
  return undefined;
}

function checkWriteGlobs(globs: readonly string[], protectedGlobs: readonly string[]): { ok: true } | { ok: false; detail: string } {
  for (const glob of globs) {
    const unsafe = unsafeGlobDetail(glob);
    if (unsafe !== undefined) return { ok: false, detail: clip(unsafe) };
  }
  for (const glob of globs) {
    for (const protectedGlob of protectedGlobs) {
      if (globsMayOverlap(glob, protectedGlob)) {
        return { ok: false, detail: clip(`write glob ${JSON.stringify(glob)} overlaps protected glob ${JSON.stringify(protectedGlob)}`) };
      }
    }
  }
  return { ok: true };
}

function samePath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isInsidePath(child: string, parent: string): boolean {
  const c = process.platform === "win32" ? child.toLowerCase() : child;
  const p = process.platform === "win32" ? parent.toLowerCase() : parent;
  if (c === p) return true;
  const prefix = p.endsWith(sep) ? p : p + sep;
  return c.startsWith(prefix);
}

/** realpath(os.tmpdir()) and, when it exists, realpath(RUNNER_TEMP). */
function mountRoots(): string[] {
  const roots: string[] = [];
  try {
    const temp = realpathSync(tmpdir());
    if (lstatSync(temp).isDirectory()) roots.push(temp);
  } catch {
    // No temp root means nothing may be mounted.
  }
  const runner = process.env.RUNNER_TEMP;
  if (typeof runner === "string" && runner.length > 0) {
    try {
      const real = realpathSync(runner);
      if (lstatSync(real).isDirectory()) roots.push(real);
    } catch {
      // A missing RUNNER_TEMP does not widen the allowlist.
    }
  }
  return roots;
}

function validateWorkDir(workDir: string): { ok: true; real: string } | { ok: false; detail: string } {
  if (typeof workDir !== "string" || workDir.length === 0 || !isAbsolute(workDir)) {
    return { ok: false, detail: "work directory must be an absolute path" };
  }
  let st: Stats;
  try {
    st = lstatSync(workDir);
  } catch {
    return { ok: false, detail: "work directory must be an existing directory inside the runner temp directory" };
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    return { ok: false, detail: "work directory must be a real directory, not a symlink" };
  }
  let real: string;
  try {
    real = realpathSync(workDir);
    if (!lstatSync(real).isDirectory()) throw new Error("not a directory");
  } catch {
    return { ok: false, detail: "work directory must be an existing directory inside the runner temp directory" };
  }
  if (!mountRoots().some((root) => isInsidePath(real, root))) {
    return { ok: false, detail: "work directory must be an existing directory inside the runner temp directory" };
  }
  try {
    toDockerMountSource(real);
  } catch (err) {
    return { ok: false, detail: clip(errorMessage(err)) };
  }
  return { ok: true, real };
}

function walkWritable(dir: string, rel: string, rootReal: string, globs: readonly string[], files: string[]): string | undefined {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    return clip(`cannot read ${rel || "."}: ${errorMessage(err)}`);
  }
  for (const name of names) {
    const childRel = rel.length === 0 ? name : `${rel}/${name}`;
    const child = join(dir, name);
    let st: Stats;
    try {
      st = lstatSync(child);
    } catch (err) {
      return clip(`cannot lstat ${childRel}: ${errorMessage(err)}`);
    }
    if (st.isSymbolicLink()) {
      // A symlink file that matches, or a symlink directory the glob would traverse, is a write escape.
      if (anyGlob(globs, childRel) || globsReachInside(globs, childRel)) return `symlink out: ${childRel}`;
      continue;
    }
    if (st.isDirectory()) {
      if (name.startsWith(".") || name === "node_modules") continue;
      if (anyGlob(globs, childRel)) return `${childRel} matches a write glob but is not a regular file`;
      const nested = walkWritable(child, childRel, rootReal, globs, files);
      if (nested !== undefined) return nested;
      continue;
    }
    if (!st.isFile()) {
      if (anyGlob(globs, childRel)) return `${childRel} matches a write glob but is not a regular file`;
      continue;
    }
    if (!anyGlob(globs, childRel)) continue;
    if (/[,:]/.test(childRel) || /[\u0000-\u001f\u007f]/.test(childRel)) {
      return `writable path ${JSON.stringify(childRel)} contains a character that would change the mount`;
    }
    let real: string;
    try {
      real = realpathSync(child);
    } catch (err) {
      return clip(`realpath failed for ${childRel}: ${errorMessage(err)}`);
    }
    const expected = join(rootReal, ...childRel.split("/"));
    if (!samePath(real, expected) || !isInsidePath(real, rootReal)) {
      return `realpath escaped the work directory: ${childRel}`;
    }
    files.push(childRel);
    if (files.length > WRITABLE_CAP) return `writable file cap of ${WRITABLE_CAP} exceeded`;
  }
  return undefined;
}

function writeProgramFiles(programDir: string, files: Readonly<Record<string, string>>): void {
  for (const [relPath, content] of Object.entries(files)) {
    if (!isSafeRel(relPath)) throw new Error(`program file ${JSON.stringify(relPath)} is not a safe relative path`);
    const dest = join(programDir, ...relPath.split("/"));
    const back = relative(programDir, dest);
    if (back === "" || back.startsWith("..") || isAbsolute(back)) {
      throw new Error(`program file ${JSON.stringify(relPath)} escapes the program directory`);
    }
    mkdirSync(join(dest, ".."), { recursive: true });
    writeFileSync(dest, content, "utf8");
  }
}

type FileSnap = { rel: string; sha256: string; bytes: number; text: string; missing: boolean };

type ComparedFile = {
  path: string;
  before_sha256: string;
  after_sha256: string;
  before_bytes: number;
  after_bytes: number;
  before_text: string;
  after_text: string;
  changed: boolean;
};

function versionMismatchDetail(
  nodeMajors: readonly string[],
  image: string,
  resolved: Record<string, string>,
  nodeVersion: string,
): string | undefined {
  const problems: string[] = [];
  if (resolved["vitest"] !== PINNED_VERSION_SET.vitest) problems.push("vitest");
  if (resolved["vite"] !== PINNED_VERSION_SET.vite) problems.push("vite");
  if (nodeMajor(nodeVersion) !== PINNED_VERSION_SET.node_major) problems.push("node");
  if (!nodeMajors.includes(PINNED_VERSION_SET.node_major)) problems.push("record node_major");
  if (image !== PINNED_VERSION_SET.image) problems.push("image");
  if (problems.length === 0) return undefined;
  return `version set mismatch: ${problems.join(", ")}`;
}

function copyPreRepair(evidence: PreRepairEvidence): PreRepairEvidence {
  if (!evidence.ran) return { ran: false, reason: evidence.reason };
  return {
    ran: true,
    exit_code: evidence.exit_code,
    failed_tests: [...evidence.failed_tests],
    passed_tests: [...evidence.passed_tests],
    ...(evidence.detail !== undefined ? { detail: evidence.detail } : {}),
  };
}

async function takePreRepair(input: ExecuteProgramInput): Promise<
  | { ok: true; evidence: PreRepairEvidence | null }
  | { ok: false; reason: "pre_repair_not_failing" | "pre_repair_unavailable"; detail: string; evidence: PreRepairEvidence | null }
> {
  if (input.preRepair === undefined) {
    if (input.require_pre_repair === true) {
      return { ok: false, reason: "pre_repair_unavailable", detail: "pre-repair evidence was required and not supplied", evidence: null };
    }
    return { ok: true, evidence: null };
  }
  let evidence: PreRepairEvidence;
  try {
    evidence = copyPreRepair(await input.preRepair());
  } catch (err) {
    return { ok: false, reason: "pre_repair_unavailable", detail: clip(errorMessage(err)), evidence: null };
  }
  if (!evidence.ran) {
    return { ok: false, reason: "pre_repair_unavailable", detail: clip(evidence.reason), evidence };
  }
  // A run counts as failing only when it named a failed test and did not exit 0.
  if (evidence.failed_tests.length === 0 || evidence.exit_code === 0) {
    return { ok: false, reason: "pre_repair_not_failing", detail: "the contract test did not fail before the repair", evidence };
  }
  return { ok: true, evidence };
}

function readSnap(root: string, rel: string): FileSnap | undefined {
  try {
    const buf = readFileSync(join(root, ...rel.split("/")));
    return {
      rel,
      sha256: `sha256:${createHash("sha256").update(buf).digest("hex")}`,
      bytes: buf.byteLength,
      text: buf.toString("utf8"),
      missing: false,
    };
  } catch {
    return undefined;
  }
}

function readSnapshots(root: string, files: readonly string[]): FileSnap[] | undefined {
  const out: FileSnap[] = [];
  for (const rel of files) {
    const snap = readSnap(root, rel);
    if (snap === undefined) return undefined;
    out.push(snap);
  }
  return out;
}

function compareSnapshots(root: string, before: readonly FileSnap[]): ComparedFile[] {
  const out: ComparedFile[] = [];
  for (const prior of before) {
    const after = readSnap(root, prior.rel);
    const missing = after === undefined;
    const afterSha = missing ? EMPTY_SHA256 : after.sha256;
    const afterBytes = missing ? 0 : after.bytes;
    const afterText = missing ? "" : after.text;
    out.push({
      path: prior.rel,
      before_sha256: prior.sha256,
      after_sha256: afterSha,
      before_bytes: prior.bytes,
      after_bytes: afterBytes,
      before_text: prior.text,
      after_text: afterText,
      changed: missing || prior.sha256 !== afterSha,
    });
  }
  return out;
}

/** Keep a leading prefix of at most `cap` UTF-8 bytes without splitting a code point. */
function capUtf8(text: string, cap: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, "utf8");
  if (buf.byteLength <= cap) return { text, truncated: false };
  let end = cap;
  // A continuation at the cut means the cut landed inside a code point. Walk back onto its lead and drop that lead.
  while (end > 0 && end < buf.byteLength && (buf[end]! & 0xc0) === 0x80) end--;
  return { text: buf.subarray(0, end).toString("utf8"), truncated: true };
}

function matchCount(re: RegExp, text: string): number {
  return [...text.matchAll(new RegExp(re.source, re.flags))].length;
}

/**
 * Lexical evidence for the step-5 verifier, not a verdict.
 * Verification is a separate fixed verifier step (step 5); this module never issues verified.
 */
function lexicalRedFlags(files: readonly ComparedFile[]): RedFlag[] {
  let testsRemoved = false;
  let skipAdded = false;
  let emptied = false;
  for (const file of files) {
    if (matchCount(TEST_CALL_RE, file.after_text) < matchCount(TEST_CALL_RE, file.before_text)) testsRemoved = true;
    if (matchCount(SKIP_DOT_RE, file.after_text) > matchCount(SKIP_DOT_RE, file.before_text)) skipAdded = true;
    if (matchCount(SKIP_ALIAS_RE, file.after_text) > matchCount(SKIP_ALIAS_RE, file.before_text)) skipAdded = true;
    if (file.after_bytes === 0 && file.before_bytes > 0) emptied = true;
  }
  const flags: RedFlag[] = [];
  if (testsRemoved) flags.push("tests_removed");
  if (skipAdded) flags.push("skip_only_todo_added");
  if (emptied) flags.push("file_emptied");
  return flags;
}

function isDaemonFailure(exitCode: number | null, stderr: string): boolean {
  if (exitCode !== 125) return false;
  return stderr.includes("Cannot connect to the Docker daemon") || stderr.includes("error during connect");
}

function mapOutcome(
  outcome: DockerRunOutcome,
  ctx: { guard: GuardResultT; writableFiles: string[]; compared: ComparedFile[]; image: string; dockerArgs: string[] },
): ExecutionCore {
  // Stdout and stderr are tails only. Their text never selects status.
  if (outcome.kind === "spawn_error") {
    return { outcome: "environment_unavailable", detail: clip(outcome.message || "Could not start Docker."), docker_invoked: true };
  }
  if (outcome.timedOut) {
    return executedBody(ctx, "timeout", outcome.exitCode, true, outcome.stdout, outcome.stderr);
  }
  if (isDaemonFailure(outcome.exitCode, outcome.stderr)) {
    return { outcome: "environment_unavailable", detail: clip(outcome.stderr.trim() || "Could not connect to the Docker daemon."), docker_invoked: true };
  }
  if (outcome.exitCode === 0) return executedBody(ctx, "ok", 0, false, outcome.stdout, outcome.stderr);
  return executedBody(ctx, "failed", outcome.exitCode, false, outcome.stdout, outcome.stderr);
}

function executedBody(
  ctx: { guard: GuardResultT; writableFiles: string[]; compared: ComparedFile[]; image: string; dockerArgs: string[] },
  status: "ok" | "failed" | "timeout",
  exitCode: number | null,
  timedOut: boolean,
  stdout: string,
  stderr: string,
): ExecutionCore {
  const changed = ctx.compared.filter((file) => file.changed).map((file) => file.path);
  const diff = ctx.compared.filter((file) => file.changed).map((file) => {
    const before = capUtf8(file.before_text, DIFF_CAP);
    const after = capUtf8(file.after_text, DIFF_CAP);
    return { path: file.path, before: before.text, after: after.text, truncated: before.truncated || after.truncated };
  });
  return {
    outcome: "executed",
    status,
    guard: ctx.guard,
    writable_files: ctx.writableFiles,
    changed_files: changed,
    docker_args: ctx.dockerArgs,
    evidence: {
      exit_code: exitCode,
      timed_out: timedOut,
      wall_ms: 0,
      image: ctx.image,
      image_digest: imageDigest(ctx.image),
      versions: {
        node: PINNED_VERSION_SET.node_major,
        vitest: PINNED_VERSION_SET.vitest,
        vite: PINNED_VERSION_SET.vite,
      },
      files: ctx.compared.map((file) => ({
        path: file.path,
        before_sha256: file.before_sha256,
        after_sha256: file.after_sha256,
        before_bytes: file.before_bytes,
        after_bytes: file.after_bytes,
        changed: file.changed,
      })),
      diff,
      no_op: changed.length === 0,
      red_flags: lexicalRedFlags(ctx.compared),
      stdout_tail: tail(stdout),
      stderr_tail: tail(stderr),
    },
  };
}

function runDocker(spawnFn: SpawnFn, req: DockerRunRequest): Promise<DockerRunOutcome> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn("docker", req.args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ kind: "spawn_error", message: errorMessage(err) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer !== undefined) clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
    };
    const finish = (result: DockerRunOutcome) => {
      if (settled) return;
      settled = true;
      clear();
      resolve(result);
    };
    const append = (current: string, chunk: unknown) => {
      if (current.length >= OUTPUT_CAP) return current;
      const text = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      const next = current + text;
      return next.length > OUTPUT_CAP ? next.slice(0, OUTPUT_CAP) : next;
    };
    child.stdout?.on("data", (chunk: unknown) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: unknown) => { stderr = append(stderr, chunk); });
    child.on("error", (err: Error) => finish({ kind: "spawn_error", message: err.message }));
    child.on("close", (exitCode: number | null) => finish({ kind: "exited", exitCode, stdout, stderr, timedOut }));
    timer = setTimeout(() => {
      timedOut = true;
      try {
        const killer = spawnFn("docker", ["kill", req.containerName], { stdio: "ignore" });
        killer.on("error", () => {});
      } catch {
        // A failed kill does not change the timeout result. The grace kill below still runs.
      }
      grace = setTimeout(() => {
        try { child.kill(); } catch { /* the child may already be gone */ }
      }, GRACE_MS);
    }, req.timeoutMs);
  });
}

const MAX_EXPANSIONS = 64;

function splitTopCommas(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/** Null when braces are unbalanced, nested, or the expansion cap would be exceeded. */
function expandBraces(pattern: string): string[] | null {
  const out: string[] = [];
  const walk = (current: string): boolean => {
    const start = current.indexOf("{");
    if (start < 0) {
      if (out.length >= MAX_EXPANSIONS) return false;
      out.push(current);
      return true;
    }
    let depth = 0;
    let end = -1;
    for (let i = start; i < current.length; i++) {
      const c = current[i];
      if (c === "{") {
        depth++;
        if (depth > 1) return false;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) return false;
    const before = current.slice(0, start);
    const after = current.slice(end + 1);
    for (const alt of splitTopCommas(current.slice(start + 1, end))) {
      if (!walk(before + alt + after)) return false;
    }
    return true;
  };
  return walk(pattern) ? out : null;
}

function wildMatch(pat: string, seg: string): boolean {
  const m = seg.length;
  let prev: boolean[] = Array.from({ length: m + 1 }, () => false);
  prev[0] = true;
  for (let i = 0; i < pat.length; i++) {
    const pc = pat.charAt(i);
    const cur: boolean[] = Array.from({ length: m + 1 }, () => false);
    if (pc === "*") cur[0] = prev[0] === true;
    for (let j = 0; j < m; j++) {
      if (pc === "*") cur[j + 1] = cur[j] === true || prev[j + 1] === true;
      else if ((pc === "?" || pc === seg.charAt(j)) && prev[j] === true) cur[j + 1] = true;
    }
    prev = cur;
  }
  return prev[m] === true;
}

/** True when some file path with `dirRel` as a strict prefix may match the glob. */
function patternReachesInside(pat: readonly string[], dir: readonly string[]): boolean {
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [[0, 0]];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head];
    head++;
    if (cur === undefined) continue;
    const pi = cur[0];
    const di = cur[1];
    const key = `${pi}:${di}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (di === dir.length) {
      if (pi < pat.length) return true;
      continue;
    }
    if (pi >= pat.length) continue;
    const seg = pat[pi];
    if (seg === undefined) continue;
    if (seg === "**") {
      queue.push([pi + 1, di]);
      queue.push([pi, di + 1]);
    } else {
      const dirSeg = dir[di];
      if (dirSeg !== undefined && wildMatch(seg, dirSeg)) queue.push([pi + 1, di + 1]);
    }
  }
  return false;
}

function globsReachInside(globs: readonly string[], dirRel: string): boolean {
  const dirSegs = dirRel.split("/");
  for (const glob of globs) {
    const expanded = expandBraces(glob);
    if (expanded === null) return true;
    for (const one of expanded) {
      if (patternReachesInside(one.split("/"), dirSegs)) return true;
    }
  }
  return false;
}
