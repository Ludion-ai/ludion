// The judge (docs/design.md, "判定役 v0"): given an npm lockfile change, may it be applied, and when?
// Pure: every fact comes in as data (registry, OSV, KEV), so the same rules run live and in the backtest.
// v0 judges gates 1, 2 and 4 and the wait. Gate 3 (build and test) is not run here, so v0 never says "apply".
import semver from "semver";

export type Urgency = "exploited" | "high" | "normal" | "low";
/** Hours to wait after the newest publish in the diff (design, "待機時間"). */
export const WAIT_HOURS: Record<Urgency, number> = { exploited: 12, high: 24, normal: 72, low: 168 };
/** An exploited fix waits 24h instead of 12h when provenance cannot be compared with the previous version. */
export const EXPLOITED_UNCOMPARABLE_HOURS = 24;
/** A publisher change, a new dependency or a new package doubles the wait, to at least the normal 72h. */
export const EXTENDED_MIN_HOURS = 72;

/** One locked package entry: what a package-lock v2/v3 says was installed at a node_modules path. */
export type LockEntry = { path: string; name: string; version: string; dev: boolean; resolved: string | null; integrity: string | null; bundled?: boolean };
/**
 * A package version that the change adds. `from` is the version it replaces: the one at the same install path, else the
 * highest of the same name and major line, else null (new to the project).
 */
export type Change = {
  path: string; name: string; from: string | null; to: string; dev: boolean; resolved: string | null; integrity: string | null;
  /** The different package that was installed at this path before (an alias now names another package), or null. */
  replaced: string | null;
};

/** What the registry and OSV say about one version, as of the moment the facts were gathered. */
export type VersionFacts = {
  /** The registry's publish time; null when unknown. */
  published_at: string | null;
  /** Still listed in the registry's versions (false: unpublished or withdrawn). */
  present: boolean;
  deprecated: string | null;
  publisher: string | null;
  /** Build provenance from the registry's attestations: null when the version has none. */
  provenance: { repository: string | null; workflow: string | null } | null;
  /** Which of preinstall, install, postinstall the version declares. */
  install_scripts: string[];
  dependencies: string[];
  /** The registry's sha512 integrity for the version's tarball. */
  integrity: string | null;
  /** OSV MAL- records naming this version. */
  malicious: string[];
  /** Other OSV advisories (vulnerabilities) naming this version. */
  advisories: string[];
};

/** The registry's own tarball URL for a version: the only `resolved` the judge accepts. */
export function registryTarball(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
}

/** A known advisory the change fixes, with what is known about its urgency. */
export type FixedAdvisory = { id: string; package: string; aliases: string[]; severity: string | null; kev: boolean; epss: number | null };

export type Finding = { gate: 1 | 2 | 4 | "wait"; package?: string; effect: "stop" | "extend" | "info"; message: string };

export type Judgement = {
  schema: 1;
  judged_at: string;
  verdict: "stop" | "wait" | "ready_except_build" | "undecidable";
  urgency: Urgency;
  wait_hours: number;
  /** The newest publish time among the changed packages: the wait counts from here. */
  newest_publish: string | null;
  wait_until: string | null;
  changes: Change[];
  fixes: FixedAdvisory[];
  findings: Finding[];
  /** Exposure-time evidence: when the newest fixing version was published, and when this judgement saw it. */
  exposure: { fix_published_at: string | null; detected_at: string };
  not_checked: string[];
};

const LIFECYCLE = ["preinstall", "install", "postinstall"];
export function installScripts(scripts: unknown): string[] {
  if (!scripts || typeof scripts !== "object") return [];
  return LIFECYCLE.filter(name => typeof (scripts as Record<string, unknown>)[name] === "string");
}

type Lockfile = { lockfileVersion?: unknown; packages?: Record<string, any> };
function readLock(lockText: string): Record<string, any> {
  const lock = JSON.parse(lockText) as Lockfile;
  if (!lock.packages || typeof lock.packages !== "object" || ![2, 3].includes(Number(lock.lockfileVersion))) throw new Error("The judge reads package-lock v2/v3 only.");
  return lock.packages;
}

/** A package-lock `packages` key: an optional workspace prefix, then one or more node_modules/<name> segments. */
const LOCK_PATH = /^(?:[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*\/)?(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+\/)*node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+$/i;
/** The name a package is required by at a path: the last node_modules segment. */
const requireName = (path: string) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

/** Installed registry packages in a package-lock v2/v3, by node_modules path. Links and the root are left out (see lockLinks). */
export function lockEntries(lockText: string): LockEntry[] {
  const entries: LockEntry[] = [];
  const folded = new Set<string>();
  for (const [path, item] of Object.entries(readLock(lockText))) {
    // On Windows and macOS, node_modules/Lodash and node_modules/lodash are one folder.
    if (folded.has(path.toLowerCase())) throw new Error(`Two package-lock paths differ only in case: ${path}.`);
    folded.add(path.toLowerCase());
    if (path.includes("\\")) throw new Error(`Unexpected package-lock path: ${path}.`);
    if (!path.includes("node_modules/")) continue;
    // A key that is not a plain install path (.., backslashes, empty segments) could make two keys mean one place.
    if (!LOCK_PATH.test(path) || path.split("/").some(segment => segment === "." || segment === "..")) throw new Error(`Unexpected package-lock path: ${path}.`);
    if (item?.link) continue;
    // An alias (node_modules/my-name with "name": "real") installs the real package.
    const name = typeof item.name === "string" ? item.name : requireName(path);
    if (typeof item.version !== "string" || !semver.valid(item.version)) throw new Error(`Invalid locked version at ${path}.`);
    entries.push({ path, name, version: item.version, dev: item.dev === true, bundled: item.inBundle === true, resolved: typeof item.resolved === "string" ? item.resolved : null, integrity: typeof item.integrity === "string" ? item.integrity : null });
  }
  return entries;
}

/** node_modules paths that are links to a local directory instead of a registry package, as "path -> target". */
export function lockLinks(lockText: string): string[] {
  return Object.entries(readLock(lockText)).filter(([path, item]) => path.includes("node_modules/") && item?.link).map(([path, item]) => `${path} -> ${String(item.resolved)}`).sort();
}

/**
 * Every installed entry that differs from the entry at the same path before (new path, other name or version, other
 * tarball or hash), every copy. Gate 4 checks all of them: re-pointing an unchanged version is a change too.
 */
export function lockEntryChanges(before: LockEntry[], after: LockEntry[]): LockEntry[] {
  const atPath = new Map(before.map(e => [e.path, e]));
  return after.filter(e => {
    const b = atPath.get(e.path);
    return !b || b.name !== e.name || b.version !== e.version || b.resolved !== e.resolved || b.integrity !== e.integrity;
  });
}

/** What Node would load for `name` required from the package at `dir` ("" for the project root): the nearest node_modules. */
function resolveFrom(entries: Map<string, LockEntry>, dir: string, name: string): LockEntry | undefined {
  let at = dir;
  while (true) {
    const found = entries.get(`${at}node_modules/${name}`);
    if (found || !at) return found;
    const up = at.replace(/node_modules\/(?:@[^/]+\/)?[^/]+\/$/, "");
    // A workspace folder has no node_modules segment to climb; the project root is next.
    at = up === at ? "" : up;
  }
}

/**
 * Every install path whose package or version changes, whether the target of a fix or not (design: check the whole
 * lockfile diff), each compared with what that path held before. Two more ways a dependent can get other code are
 * judged too: a path that moves to a version already installed elsewhere, and a removed nested copy, after which its
 * dependent falls back to whatever Node resolution finds further up. A copy that only moved to a new path, with the
 * same version and the same hash as one already installed, changes nothing to judge; gate 4 still checks its tarball.
 */
export function lockDiff(before: LockEntry[], after: LockEntry[]): Change[] {
  const atPath = new Map(before.map(e => [e.path, e])), afterAt = new Map(after.map(e => [e.path, e]));
  const changes = new Map<string, Change>();
  const add = (entry: LockEntry, from: LockEntry | undefined, previous: string | null, replaced: string | null) => {
    const key = `${entry.name}\0${previous}\0${entry.version}\0${replaced}\0${entry.integrity}`;
    const existing = changes.get(key);
    // A version counts as dev only when every copy of it is dev.
    changes.set(key, existing ? { ...existing, dev: existing.dev && entry.dev } : { path: from?.path ?? entry.path, name: entry.name, from: previous, to: entry.version, dev: entry.dev, resolved: entry.resolved, integrity: entry.integrity, replaced });
  };
  for (const entry of after) {
    const samePath = atPath.get(entry.path);
    if (samePath && samePath.name === entry.name && samePath.version === entry.version && samePath.integrity === entry.integrity) continue;
    const replaced = samePath && samePath.name !== entry.name ? `${samePath.name}@${samePath.version}` : null;
    const previous = samePath?.name === entry.name ? samePath.version
      : before.filter(e => e.name === entry.name && semver.major(e.version) === semver.major(entry.version)).map(e => e.version).sort(semver.rcompare)[0] ?? null;
    if (!replaced && !samePath && previous === entry.version && before.some(e => e.name === entry.name && e.version === entry.version && e.integrity === entry.integrity)) continue;
    add(entry, undefined, previous, replaced);
  }
  for (const gone of before) {
    if (afterAt.has(gone.path)) continue;
    // The package that depended on the removed copy; if it is gone too, nothing requires the name from there.
    const dependent = gone.path.slice(0, gone.path.lastIndexOf("node_modules/"));
    if (dependent.includes("node_modules/") && !afterAt.has(dependent.replace(/\/$/, ""))) continue;
    const now = resolveFrom(afterAt, dependent, requireName(gone.path));
    if (!now || (now.name === gone.name && now.version === gone.version && now.integrity === gone.integrity)) continue;
    add(now, gone, now.name === gone.name ? gone.version : null, now.name === gone.name ? null : `${gone.name}@${gone.version}`);
  }
  return [...changes.values()].sort((a, b) => a.name.localeCompare(b.name) || semver.compare(a.to, b.to) || a.path.localeCompare(b.path));
}

/** Something that requires packages: the project root, a workspace folder, or an installed package (by name@version). */
type Consumer = { id: string; dir: string; requires: string[] };
const DECLARED = ["dependencies", "optionalDependencies", "peerDependencies"];

function consumers(lockText: string): Consumer[] {
  const out: Consumer[] = [];
  for (const [path, item] of Object.entries(readLock(lockText))) {
    if (!item || typeof item !== "object" || item.link) continue;
    const own = path === "" || !path.includes("node_modules/");
    // The root and workspace folders also require their devDependencies; installed packages do not.
    const groups = own ? [...DECLARED, "devDependencies"] : DECLARED;
    const requires = [...new Set(groups.flatMap(group => item[group] && typeof item[group] === "object" ? Object.keys(item[group]) : []))].sort();
    const id = own ? `<${path || "root"}>` : `${typeof item.name === "string" ? item.name : requireName(path)}@${item.version}`;
    out.push({ id, dir: path ? `${path}/` : "", requires });
  }
  return out;
}

/**
 * What every dependent loads, before and after: for each consumer that exists on both sides (the root, a workspace or
 * an installed name@version, wherever it sits) and each package it declares, the package Node resolution finds. A
 * target it did not load before is a change, however the tree moved to get there: a shadowing copy, a moved dependent,
 * a removed copy, an alias.
 */
export function resolutionChanges(beforeText: string, afterText: string): Change[] {
  const targets = (text: string) => {
    const entries = new Map(lockEntries(text).map(e => [e.path, e]));
    const map = new Map<string, LockEntry[]>();
    for (const c of consumers(text)) for (const name of c.requires) {
      const target = resolveFrom(entries, c.dir, name);
      if (!target) continue;
      const key = `${c.id}\0${name}`;
      map.set(key, [...(map.get(key) ?? []), target]);
    }
    return map;
  };
  const before = targets(beforeText), after = targets(afterText);
  const changes = new Map<string, Change>();
  for (const [key, now] of after) {
    const was = before.get(key);
    if (!was) continue; // A new consumer or a new requirement: its packages are judged as installed changes.
    for (const target of now) {
      if (was.some(w => w.name === target.name && w.version === target.version && w.integrity === target.integrity)) continue;
      const sameName = was.filter(w => w.name === target.name).map(w => w.version).sort(semver.rcompare)[0] ?? null;
      const replaced = sameName === null ? `${was[0]!.name}@${was[0]!.version}` : null;
      const id = `${target.name}\0${sameName}\0${target.version}\0${replaced}\0${target.integrity}`;
      const existing = changes.get(id);
      changes.set(id, existing ? { ...existing, dev: existing.dev && target.dev } : { path: target.path, name: target.name, from: sameName, to: target.version, dev: target.dev, resolved: target.resolved, integrity: target.integrity, replaced });
    }
  }
  return [...changes.values()];
}

/** The lockfile diff and the resolution diff together, without duplicates. */
export function allChanges(beforeText: string, afterText: string): Change[] {
  const merged = new Map<string, Change>();
  for (const c of [...lockDiff(lockEntries(beforeText), lockEntries(afterText)), ...resolutionChanges(beforeText, afterText)]) {
    const key = `${c.name}\0${c.from}\0${c.to}\0${c.replaced}\0${c.integrity}`;
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, dev: existing.dev && c.dev } : c);
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name) || semver.compare(a.to, b.to) || a.path.localeCompare(b.path));
}

const DEPENDENCY_GROUPS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
/** A registry range, or an npm: alias of a registry range. Git, URL, file:, link: and workspace: specs are not. */
function registrySpec(spec: unknown): boolean {
  if (typeof spec !== "string") return false;
  const alias = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(.+)$/i.exec(spec);
  return !!semver.validRange(alias ? alias[2]! : spec);
}
/**
 * Why a package.json change is more than a dependency update: any other field (scripts run on install, for one), or a
 * dependency or override that leaves the registry.
 */
export function manifestChanges(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  if (typeof after !== "object" || after === null || Array.isArray(after)) return ["package.json is not an object."];
  const out: string[] = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (JSON.stringify(b[key]) === JSON.stringify(a[key])) continue;
    if (key === "overrides") {
      const specs: unknown[] = [];
      const walk = (value: unknown): void => { if (value && typeof value === "object") Object.values(value).forEach(walk); else specs.push(value); };
      walk(a[key]);
      if (specs.some(spec => !(typeof spec === "string" && (spec.startsWith("$") || registrySpec(spec))))) out.push("package.json overrides point outside the npm registry.");
      continue;
    }
    if (!DEPENDENCY_GROUPS.includes(key)) { out.push(`package.json changes "${key}", which is not a dependency list (scripts, for one, run on install).`); continue; }
    if (a[key] !== undefined && (typeof a[key] !== "object" || a[key] === null || Array.isArray(a[key]))) { out.push(`package.json ${key} is not an object of name: range.`); continue; }
    const group = (a[key] ?? {}) as Record<string, unknown>, old = (b[key] ?? {}) as Record<string, unknown>;
    for (const [name, spec] of Object.entries(group)) if (spec !== old[name] && !registrySpec(spec)) out.push(`package.json ${key}.${name} is "${String(spec)}", not a registry range.`);
  }
  return out;
}

/** Urgency of the change: from the advisories it fixes, and whether any fixed package is used in production. */
export function urgencyOf(fixes: FixedAdvisory[], changes: Change[], epssHigh = 0.1): Urgency {
  const fixed = fixes.filter(f => changes.some(c => c.name === f.package));
  // A fix's urgency counts only for the packages it fixes: a dev-only fix does not hurry a production passenger.
  const fixing = changes.filter(c => fixed.some(f => f.package === c.name) && !c.dev);
  if (!changes.some(c => !c.dev)) return "low";
  if (!fixing.length) return "normal";
  const urgent = fixed.filter(f => fixing.some(c => c.name === f.package));
  if (urgent.some(f => f.kev)) return "exploited";
  if (urgent.some(f => f.severity?.toUpperCase() === "CRITICAL" || (f.epss !== null && f.epss >= epssHigh))) return "high";
  return "normal";
}

/**
 * Judge one lockfile change. `facts` holds the facts for every changed version (`name@to`) and its predecessor
 * (`name@from`). A missing fact is undecidable, never a pass.
 */
export function judge(input: {
  changes: Change[];
  facts: Map<string, VersionFacts>;
  fixes: FixedAdvisory[];
  /** Files the change touches, relative to the project root; null when the caller could not tell (then undecidable). */
  files: string[] | null;
  /** Links to a local directory that are new or point elsewhere ("path -> target"). */
  links?: string[];
  /** Every installed entry that changed at its path (lockEntryChanges); by default the first copy of each change. */
  entries?: LockEntry[];
  now: Date;
  /** A stricter project wait, in hours, per urgency (design: the stricter setting wins). */
  projectWait?: Partial<Record<Urgency, number>>;
  /** Lookup failures: each makes the judgement undecidable. */
  errors?: string[];
  /** package.json before and after, when it changed: only registry dependency specs may change. */
  manifest?: { before: unknown; after: unknown };
}): Judgement {
  const { changes, facts, fixes, now } = input;
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  const urgency = urgencyOf(fixes, changes);
  let undecidable = false;
  for (const error of input.errors ?? []) { add({ gate: 2, effect: "stop", message: `A lookup failed: ${error.slice(0, 300)}` }); undecidable = true; }
  if (!changes.length && !(input.links ?? []).length) {
    add({ gate: 1, effect: "info", message: "The lockfile change adds no package version." });
    undecidable = true;
  }

  // Gate 4: one revertible change to the dependency files only, with every added version pinned to the registry's own
  // tarball and hash for exactly that name and version.
  if (input.files === null || !input.files.includes("package-lock.json")) {
    add({ gate: 4, effect: "info", message: input.files === null ? "The PR's changed files were not given (--files), so gate 4 could not check that only package.json and package-lock.json change." : "The given changed files do not include package-lock.json, although the lockfile changed." });
    undecidable = true;
  } else {
    const unexpected = input.files.filter(f => !["package.json", "package-lock.json"].includes(f));
    if (unexpected.length) add({ gate: 4, effect: "stop", message: `The change also touches ${unexpected.join(", ")}; a dependency update must change only package.json and package-lock.json.` });
  }
  if (input.manifest) for (const message of manifestChanges(input.manifest.before, input.manifest.after)) add({ gate: 4, effect: "stop", message });
  for (const link of input.links ?? []) add({ gate: 4, effect: "stop", message: `${link}: a link to a local directory that is new or points elsewhere, instead of a registry package.` });
  const entries: LockEntry[] = input.entries ?? changes.map(c => ({ path: c.path, name: c.name, version: c.to, dev: c.dev, resolved: c.resolved, integrity: c.integrity }));
  for (const e of entries) {
    const where = `${e.name}@${e.version} at ${e.path}`;
    if (e.bundled) { add({ gate: 4, package: e.name, effect: "stop", message: `${where} is bundled inside its parent and has no registry tarball of its own; a change to a bundled dependency needs review.` }); continue; }
    if (e.resolved !== registryTarball(e.name, e.version)) add({ gate: 4, package: e.name, effect: "stop", message: `${where} resolves to ${e.resolved ?? "nothing"}, not the registry's tarball ${registryTarball(e.name, e.version)}.` });
    const fact = facts.get(`${e.name}@${e.version}`);
    if (!e.integrity?.startsWith("sha512-")) add({ gate: 4, package: e.name, effect: "stop", message: `${where} has no sha512 integrity in the lockfile.` });
    else if (!fact) { add({ gate: 4, package: e.name, effect: "stop", message: `No registry facts to check the integrity of ${where}; undecidable.` }); undecidable = true; }
    else if (fact.integrity !== e.integrity) add({ gate: 4, package: e.name, effect: "stop", message: `${where}: the lockfile integrity is not the registry's (${fact.integrity ?? "none"}).` });
  }

  // Gate 2: every changed version, compared with the version it replaces.
  let comparable = changes.length > 0, extended = false;
  let newest: string | null = null;
  for (const c of changes) {
    const next = facts.get(`${c.name}@${c.to}`);
    const prev = c.from ? facts.get(`${c.name}@${c.from}`) : undefined;
    if (!next || (c.from && !prev)) {
      add({ gate: 2, package: c.name, effect: "stop", message: `No registry facts for ${c.name}@${c.to}${c.from ? ` or ${c.from}` : ""}; undecidable.` });
      undecidable = true; comparable = false; continue;
    }
    if (!next.published_at || !Number.isFinite(Date.parse(next.published_at))) {
      add({ gate: "wait", package: c.name, effect: "stop", message: `${c.name}@${c.to} has no publish time; the wait cannot be measured.` });
      undecidable = true;
    } else if (!newest || Date.parse(next.published_at) > Date.parse(newest)) newest = next.published_at;
    if (next.malicious.length) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} is in OSV's malicious-package records (${next.malicious.join(", ")}).` });
    if (!next.present) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} is no longer listed by the registry (unpublished or withdrawn).` });
    if (next.deprecated) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} is deprecated: ${next.deprecated.slice(0, 200)}` });
    if (c.replaced) add({ gate: 2, package: c.name, effect: "stop", message: `${c.path} now installs ${c.name}@${c.to} instead of ${c.replaced}: another package under the same name.` });
    if (c.from && semver.lt(c.to, c.from)) add({ gate: 1, package: c.name, effect: "stop", message: `${c.name} goes down from ${c.from} to ${c.to} at ${c.path}.` });
    const introduced = next.advisories.filter(id => !prev?.advisories.includes(id));
    if (introduced.length) add({ gate: 1, package: c.name, effect: "stop", message: `${c.name}@${c.to} has known advisories ${c.from ? `that ${c.from} did not have` : "and is new to the project"}: ${introduced.join(", ")}.` });
    const remaining = next.advisories.filter(id => prev?.advisories.includes(id));
    if (remaining.length) add({ gate: 1, package: c.name, effect: "info", message: `${c.name}@${c.to} still has known advisories: ${remaining.join(", ")}.` });
    // No usable predecessor (new, or itself unpublished): nothing to compare provenance, publisher or scripts with.
    if (!prev || !prev.present) {
      add({ gate: 2, package: c.name, effect: "extend", message: prev ? `${c.name}@${c.from}, the version it replaces, is no longer listed; there is nothing to compare with.` : `${c.name} is new to the project; there is no earlier version to compare with.` });
      extended = true; comparable = false;
      if (next.install_scripts.length) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} has no comparable predecessor and runs install scripts (${next.install_scripts.join(", ")}).` });
      continue;
    }
    if (prev.provenance && !next.provenance) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.from} had build provenance and ${c.to} has none.` });
    else if (prev.provenance && next.provenance && (prev.provenance.repository !== next.provenance.repository || prev.provenance.workflow !== next.provenance.workflow)) {
      add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} was built from ${next.provenance.repository ?? "?"} ${next.provenance.workflow ?? "?"}, not ${prev.provenance.repository ?? "?"} ${prev.provenance.workflow ?? "?"} like ${c.from}.` });
    }
    // Comparable only when both sides name a repository and a workflow.
    if (!prev.provenance?.repository || !prev.provenance.workflow || !next.provenance?.repository || !next.provenance.workflow) comparable = false;
    const added = next.install_scripts.filter(s => !prev.install_scripts.includes(s));
    if (added.length) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} adds install scripts: ${added.join(", ")}.` });
    if (prev.publisher !== next.publisher) { add({ gate: 2, package: c.name, effect: "extend", message: `${c.name}@${c.to} was published by ${next.publisher ?? "unknown"}, ${c.from} by ${prev.publisher ?? "unknown"}.` }); extended = true; }
    const newDeps = next.dependencies.filter(d => !prev.dependencies.includes(d));
    if (newDeps.length) { add({ gate: 2, package: c.name, effect: "extend", message: `${c.name}@${c.to} adds dependencies: ${newDeps.join(", ")}.` }); extended = true; }
  }

  let wait = WAIT_HOURS[urgency];
  if (urgency === "exploited" && !comparable) wait = EXPLOITED_UNCOMPARABLE_HOURS;
  if (extended) wait = Math.max(wait * 2, EXTENDED_MIN_HOURS);
  const stricter = input.projectWait?.[urgency];
  if (stricter !== undefined && stricter > wait) wait = stricter;
  const waitUntil = newest ? new Date(Date.parse(newest) + wait * 3_600_000).toISOString() : null;

  const stopped = findings.some(f => f.effect === "stop");
  const verdict: Judgement["verdict"] = undecidable ? "undecidable" : stopped ? "stop" : waitUntil && now.getTime() < Date.parse(waitUntil) ? "wait" : "ready_except_build";
  const fixing = changes.filter(c => fixes.some(f => f.package === c.name)).map(c => facts.get(`${c.name}@${c.to}`)?.published_at).filter((t): t is string => !!t).sort();
  return {
    schema: 1, judged_at: now.toISOString(), verdict, urgency, wait_hours: wait, newest_publish: newest, wait_until: waitUntil,
    changes, fixes, findings,
    exposure: { fix_published_at: fixing.at(-1) ?? null, detected_at: now.toISOString() },
    not_checked: [
      "Gate 3 (build and tests of old and new versions) is not run by the judge v0.",
      "Obfuscated code and new network or process calls in the changed code are not inspected.",
      "Gate 1's OS, SAPI and configuration conditions are not matched; only production versus dev-only is used.",
      "Provenance is read from the registry's attestation record; its Sigstore signature is not verified here.",
      "A hijacked publisher account with no provenance change is caught only by the wait and the re-query when it ends; the re-query happens only when the judge is run again after the wait (nothing schedules it yet).",
      "The lockfile is read as npm 7 or later reads it (`packages`); the legacy `dependencies` section of a v2 lockfile is not compared.",
    ],
  };
}

/** The judgement as a PR comment. Plain text; every reason is shown. */
export function renderJudgement(j: Judgement): string {
  const head = { stop: "Ludion judgement: STOP — not applied automatically", wait: `Ludion judgement: wait until ${j.wait_until}`, ready_except_build: "Ludion judgement: gates 1, 2 and 4 found nothing and the wait is over — build/test gate not run (v0)", undecidable: "Ludion judgement: undecidable — not applied automatically" }[j.verdict];
  const lines = [head, `Urgency: ${j.urgency} · wait ${j.wait_hours}h from the newest publish (${j.newest_publish ?? "unknown"})`];
  lines.push(`Changed packages (${j.changes.length}):`);
  for (const c of j.changes) lines.push(`  ${c.name} ${c.from ?? "(new)"} → ${c.to}${c.dev ? " (dev)" : ""}${c.replaced ? ` (replaces ${c.replaced} at ${c.path})` : ""}`);
  if (j.fixes.length) lines.push(`Fixes: ${[...new Set(j.fixes.map(f => f.id))].join(", ")}`);
  const order = { stop: 0, extend: 1, info: 2 } as const;
  for (const f of [...j.findings].sort((a, b) => order[a.effect] - order[b.effect])) lines.push(`  [${f.effect}] gate ${f.gate}: ${f.message}`);
  if (!j.findings.length) lines.push("  No gate finding.");
  lines.push("Not checked:");
  for (const n of j.not_checked) lines.push(`  - ${n}`);
  lines.push(`Exposure: fix published ${j.exposure.fix_published_at ?? "n/a"} · seen ${j.exposure.detected_at}`);
  return lines.join("\n");
}
