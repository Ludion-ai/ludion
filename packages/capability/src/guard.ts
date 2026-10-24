import { anyGlob } from "./glob.ts";
import { verifyRecord } from "./hash.ts";
import { nodeMajor } from "./node-version.ts";
import { analyze, readConfigKey, resolveTarget } from "./scan.ts";
import type { CapabilityRecordT, GuardResultT, StructureConditionT } from "./schema.ts";

export type GuardInput = {
  contract_id?: string;
  files: Record<string, string>;
  /** Package name to exact version from the lockfile. Null means the lockfile could not be read. */
  resolved_versions: Record<string, string> | null;
  node_version?: string;
  /** Accepted and ignored. Similarity never grants or denies execution. */
  similarity?: number;
};

type Check = { condition: string; ok: boolean | null; note?: string };
type Hit = { file: string; line: number; via: "import" | "alias"; braceId: number };

function check(condition: string, ok: boolean | null, note?: string): Check {
  return note === undefined ? { condition, ok } : { condition, ok, note: note.slice(0, 300) };
}

function detail(s: string): string {
  return s.slice(0, 500);
}

function isRel(p: string): boolean {
  return p.length > 0 && p.length <= 260 && !/^([\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes("..");
}

type InapplicableReason = Extract<GuardResultT, { status: "inapplicable" }>["reason"];
type UnknownReason = Extract<GuardResultT, { status: "unknown" }>["reason"];

function inapplicable(reason: InapplicableReason, text: string, checks: Check[]): GuardResultT {
  return { status: "inapplicable", reason, detail: detail(text), checks };
}

function unknown(reason: UnknownReason, text: string, checks: Check[]): GuardResultT {
  return { status: "unknown", reason, detail: detail(text), checks };
}

/**
 * Pure structural guard. Order: record integrity, contract, packages, node major, config, calls.
 * A missing contract id is unknown/intent_missing. Listed versions only; anything else is unknown.
 * Node is compared by major. `similarity` is ignored.
 */
export function evaluateGuard(record: CapabilityRecordT, input: GuardInput): GuardResultT {
  void input.similarity;
  const checks: Check[] = [];
  const integrity = verifyRecord(record);
  if (!("ok" in integrity)) return integrity;
  checks.push(check("record", true));

  if (input.contract_id === undefined) {
    checks.push(check("contract", null, "caller did not pass contract_id"));
    return unknown("intent_missing", "contract_id was not provided", checks);
  }
  if (input.contract_id !== record.artifact.guard.contract_id) {
    checks.push(check("contract", false, input.contract_id));
    return inapplicable("contract_mismatch", `contract ${input.contract_id} does not match ${record.artifact.guard.contract_id}`, checks);
  }
  checks.push(check("contract", true));

  if (input.resolved_versions === null) {
    checks.push(check("packages", null, "lockfile unreadable"));
    return unknown("lockfile_unreadable", "resolved_versions is null", checks);
  }
  const versions = input.resolved_versions;
  for (const pkg of record.artifact.guard.packages) {
    const got = versions[pkg.name];
    if (got === undefined) {
      checks.push(check(`package:${pkg.name}`, false, "absent"));
      return inapplicable("package_absent", `${pkg.name} is not in the lockfile`, checks);
    }
    if (pkg.inapplicable_versions.includes(got)) {
      checks.push(check(`package:${pkg.name}`, false, got));
      return inapplicable("version_verified_inapplicable", `${pkg.name}@${got} was verified inapplicable`, checks);
    }
    if (pkg.applicable_versions.includes(got)) {
      checks.push(check(`package:${pkg.name}`, true, got));
      continue;
    }
    checks.push(check(`package:${pkg.name}`, null, got));
    return unknown("version_unverified", `${pkg.name}@${got} is not a listed version`, checks);
  }

  if (input.node_version === undefined) {
    checks.push(check("runtime", null, "node version missing"));
    return unknown("environment_unavailable", "node_version was not provided", checks);
  }
  const major = nodeMajor(input.node_version);
  if (major === null) {
    checks.push(check("runtime", null, input.node_version));
    return unknown("environment_unavailable", `node version ${input.node_version} is not vX.Y.Z`, checks);
  }
  if (!record.artifact.guard.runtime.node_major.includes(major)) {
    checks.push(check("runtime", false, major));
    return inapplicable("runtime_mismatch", `node major ${major} is outside ${record.artifact.guard.runtime.node_major.join(",")}`, checks);
  }
  checks.push(check("runtime", true, major));

  const configResult = evaluateConfigs(record.artifact.guard.structure, input.files, checks);
  if (configResult) return configResult;

  return evaluateCalls(record.artifact.guard.structure, input.files, checks);
}

function evaluateConfigs(structure: readonly StructureConditionT[], files: Record<string, string>, checks: Check[]): GuardResultT | undefined {
  const configs = structure.filter((c) => c.kind === "config");
  for (const condition of configs) {
    const label = `config:${condition.key}`;
    const matched = Object.entries(files).filter(([path]) => isRel(path) && anyGlob(condition.file, path));
    if (matched.length === 0) {
      checks.push(check(label, true, "no config file"));
      continue;
    }
    let excluding = false;
    let saw = false;
    for (const [path, text] of matched) {
      const read = readConfigKey(text, condition.key);
      if (read.kind === "parse_failed") {
        checks.push(check(label, null, read.detail));
        return unknown("parse_failed", `${path}: ${read.detail}`, checks);
      }
      if (read.kind === "not-static") {
        checks.push(check(label, null, path));
        return unknown("config_not_static", `${path} is not a static config object`, checks);
      }
      if (read.kind === "absent") continue;
      saw = true;
      if (read.value === condition.inapplicable_if) excluding = true;
    }
    if (excluding) {
      checks.push(check(label, false, String(condition.inapplicable_if)));
      return inapplicable("config_excludes", `${condition.key} is ${String(condition.inapplicable_if)}`, checks);
    }
    checks.push(check(label, true, saw ? "value does not exclude" : "key absent"));
  }
  return undefined;
}

function evaluateCalls(structure: readonly StructureConditionT[], files: Record<string, string>, checks: Check[]): GuardResultT {
  const calls = structure.filter((c) => c.kind === "call");
  const cache = new Map<string, ReturnType<typeof analyze>>();
  const analyzed = (path: string, text: string) => {
    let hit = cache.get(path);
    if (!hit) {
      hit = analyze(text);
      cache.set(path, hit);
    }
    return hit;
  };

  const perCondition: Array<{ condition: string; presence: "required" | "absent_in_scope"; hits: Hit[]; unresolved: boolean }> = [];
  for (const condition of calls) {
    const label = `call:${condition.target.module}.${condition.target.export}.${condition.target.member.join(".")}`;
    const hits: Hit[] = [];
    let unresolved = false;
    const matchedFiles = Object.entries(files).filter(([path]) => isRel(path) && anyGlob(condition.files, path));
    for (const [path, text] of matchedFiles) {
      const filePath = path.replaceAll("\\", "/");
      const found = analyzed(filePath, text);
      if (found.error) {
        checks.push(check(label, null, found.error));
        return unknown("parse_failed", `${filePath}: ${found.error}`, checks);
      }
      const resolved = resolveTarget(found, condition.target);
      if (resolved.unresolved) unresolved = true;
      for (const match of resolved.matches) {
        hits.push({ file: filePath, line: match.line, via: match.via, braceId: match.braceId });
      }
    }
    perCondition.push({ condition: label, presence: condition.presence, hits, unresolved });
  }

  for (const item of perCondition) {
    if (!item.unresolved) continue;
    checks.push(check(item.condition, null, "binding unresolved"));
    return unknown("binding_unresolved", `${item.condition} has a call that is not import-bound`, checks);
  }

  const requiredHits = perCondition.filter((c) => c.presence === "required").flatMap((c) => c.hits);
  for (const item of perCondition) {
    if (item.presence === "required" && item.hits.length === 0) {
      checks.push(check(item.condition, false, "no resolved call"));
      return inapplicable("target_absent", `${item.condition} has no resolved call`, checks);
    }
    if (item.presence === "absent_in_scope") {
      const clash = item.hits.some((hit) => requiredHits.some((req) => req.file === hit.file && req.braceId === hit.braceId));
      if (clash) {
        checks.push(check(item.condition, false, "same brace block as a required call"));
        return inapplicable("already_fixed", `${item.condition} is already present in the required call's block`, checks);
      }
    }
    checks.push(check(item.condition, true, `${item.hits.length} resolved`));
  }

  if (requiredHits.length === 0) {
    checks.push(check("call", false, "no required call match"));
    return inapplicable("target_absent", "no resolved required call", checks);
  }
  return {
    status: "applicable",
    reason: "all_conditions_met",
    matches: requiredHits.map((h) => ({ file: h.file, line: h.line, via: h.via })),
    detail: "all guard conditions met",
    checks,
  };
}
