// The oldest version in range (docs/decisions/2026-11-03-oldest-resolution-in-product.md). npm has no way to choose it
// (docs/bench/lold/definitions.md, section 2), so the host decides from package metadata alone and writes a table of
// requirement to version; in the resolver's container, npm's own `install --package-lock-only` runs with one function,
// pacote.manifest, answering from that table. Placement, peer sets, flags, the writer and the acquisition flags stay
// npm's and the product's. No code of any package runs here, and only names and versions leave the machine.
import semver from "semver";
import type { Finding } from "./osv.ts";
import { OsvClient } from "./osv.ts";
import type { Change } from "./inventory.ts";
import { lockKey, readLock, releaseIdentity, requireName, resolveFrom } from "./judge.ts";
import { osvIds, registryDocument, registryFacts } from "./npm-facts.ts";
import { sameRelease, type ReleaseIdentity } from "./time-cap.ts";

export type ExclusionCounts = { in_range: number; no_time: number; after_t: number; withdrawn: number; deprecated: number; advisory: number };
export type AnswerRole = "v" | "reused_base" | "oldest" | "same_release";
/** One requirement and what it gets. `version` null: nothing is left, or it is a tag. */
export type Answer = {
  requirement: string; name: string; version: string | null; role: AnswerRole | null; published_at: string | null;
  /** Versions passed over before this one, oldest first, at most PASSED_OVER_LIMIT, with why. */
  passed_over: { version: string; reason: string }[];
  excluded: ExclusionCounts;
  reason?: string;
};
export type ResolutionTable = {
  /** T: the later of V's publish time and the earliest OSV `published` of the fix's advisories. */
  t: string; t_note: string;
  answers: Record<string, Answer>;
  /** The versions the table holds for the fix's own package. */
  v: Record<string, string[]>;
  /** `name@version` of everything the project's lockfile holds: a version already there brings in no new code. */
  locked: Set<string>;
  /** A version's publish time, from the documents already read; null when the registry gives none. */
  publishedAt: (name: string, version: string) => Promise<string | null>;
};
/** A version in the fix's diff, as npm wrote it. */
export type AssertedVersion = { path: string; name: string; version: string; role: AnswerRole | null; published_at: string | null; age_hours: number | null };
/** The asserts' result, in the receipt. `problems` stop the fix, and `waits` hold it until `wait_until`. */
export type ResolutionAssert = {
  t: string; pushed_at: string; wait_hours: number;
  /** The earlier of T and push − wait. */
  resolved_at: string;
  /** The plan's sentence read with T as the time of first sight. Written down; it stops nothing (the decision, section 3). */
  t_before_push_less_wait: boolean;
  /** The youngest version in the diff: its publish time + the wait is the line. */
  youngest: string | null; wait_until: string | null;
  versions: AssertedVersion[];
  waits: string[]; problems: string[];
};
/** What the fix's receipt says of its resolution. */
export type FixResolution = {
  t: string; t_note: string;
  /** How many requirements the table held. */
  requirements: number;
  /** The answers the diff used, then those with no version, at most RECEIPT_ANSWERS. */
  answers: Answer[];
  /** The fix stopped because nothing was left in range and that made npm's run fail: the stop rate's numerator (the decision, section 4). */
  stopped_no_allowed: boolean;
  /** npm asked about a requirement with no answer: the one it asked about. */
  no_answer?: string;
  assert?: ResolutionAssert;
};

/** At most this many requirements in one table: more stops the fix rather than reading the registry on and on. */
export const REQUIREMENT_LIMIT = 5000;
/** How many versions OSV is asked about at once, oldest first, until one is clean. */
const OSV_CHUNK = 25;
/** How many passed-over versions a receipt lists for one requirement. The counts are always whole. */
export const PASSED_OVER_LIMIT = 20;
/** How many answers one fix's receipt lists. */
export const RECEIPT_ANSWERS = 200;
/** How many versions published after T are compared with V as the same release. */
const SAME_RELEASE_LIMIT = 10;

const HOUR = 3_600_000;
const plain = (text: string) => text.replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 200);
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const time = (at: unknown) => typeof at === "string" ? Date.parse(at) : NaN;
const RESERVED_TIME = new Set(["created", "modified", "unpublished"]);

/**
 * T, until a first run's time is recorded (the decision, section 1), from V's publish times, which the caller has read.
 * An advisory with no readable `published` does not move T.
 */
export function resolutionTime(published: number[], changes: Change[], findings: Finding[]): { t: number; note: string } {
  const v = Math.max(...published);
  const ids = new Set(changes.flatMap(c => c.advisories));
  const seen = findings.filter(f => ids.has(f.advisory.id)).map(f => time(f.advisory.published)).filter(Number.isFinite);
  const advisory = seen.length ? Math.min(...seen) : null;
  const t = advisory === null ? v : Math.max(v, advisory);
  return { t, note: advisory === null ? "V's registry publish time: OSV gives no publish time for the fix's advisories. The time of first sight is not recorded; this is a lower bound on it." : "The later of V's registry publish time and the earliest OSV publish time of the fix's advisories. The time of first sight is not recorded; this is a lower bound on it." };
}

type Doc = { time: Record<string, unknown>; versions: Record<string, any> };
type Requirement = { name: string; spec: string };

/** A requirement as the registry would answer it: an alias's target and range; null for a Git, URL or file spec, which npm's flags refuse. */
export function registryRequirement(name: string, rawSpec: unknown): Requirement | null {
  if (typeof rawSpec !== "string") return null;
  const spec = rawSpec.trim() || "*";
  if (spec.startsWith("npm:")) {
    const target = spec.slice(4), at = target.lastIndexOf("@");
    return at > 0 ? { name: target.slice(0, at), spec: target.slice(at + 1).trim() || "*" } : { name: target, spec: "*" };
  }
  if (/^[a-z+]+:|[/\\]/i.test(spec)) return null;
  return { name, spec };
}

/** What a manifest requires of npm: dependencies, optional ones and peers that are not optional. An optional peer adds nothing. */
export function requirementsOf(manifest: Record<string, any>): Requirement[] {
  const meta = isObject(manifest.peerDependenciesMeta) ? manifest.peerDependenciesMeta : {};
  const out: Requirement[] = [];
  for (const group of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    if (!isObject(manifest[group])) continue;
    for (const [name, spec] of Object.entries(manifest[group])) {
      if (group === "peerDependencies" && Object.hasOwn(meta, name) && meta[name]?.optional === true) continue;
      const requirement = registryRequirement(name, spec);
      if (requirement) out.push(requirement);
    }
  }
  return out;
}

const keyOf = (r: Requirement) => `${r.name}@${r.spec}`;

/** Every string a project's `overrides` gives a package: npm asks about these in place of the range the requirer writes. */
function overridden(overrides: unknown, parent?: string): Requirement[] {
  if (!isObject(overrides)) return [];
  return Object.entries(overrides).flatMap(([key, value]) => {
    const at = key.lastIndexOf("@"), name = at > 0 ? key.slice(0, at) : key;
    if (key === ".") { const own = parent && registryRequirement(parent, value); return own ? [own] : []; }
    if (typeof value === "string") { const own = value.startsWith("$") ? null : registryRequirement(name, value); return own ? [own] : []; }
    return overridden(value, name);
  });
}

/**
 * The table for one fix (the decision, section 2): walks what V requires, and what each answer requires, through the
 * registry's metadata. It holds more than npm will ask about, since it does not know where npm will place a copy. A read
 * that fails throws, and the fix stops.
 */
export async function resolveOldest(input: { plan: Change[]; baseLock: string; finalManifest: string; findings: Finding[]; fetchFn?: typeof fetch; limit?: number }): Promise<ResolutionTable> {
  const fetchFn = input.fetchFn ?? fetch, limit = input.limit ?? REQUIREMENT_LIMIT;
  const docs = new Map<string, Promise<Doc | null>>();
  // Only what a choice reads is kept: a whole document can be tens of megabytes, and a table can read hundreds.
  const kept = (manifest: unknown) => isObject(manifest) ? { dependencies: manifest.dependencies, optionalDependencies: manifest.optionalDependencies, peerDependencies: manifest.peerDependencies, peerDependenciesMeta: manifest.peerDependenciesMeta, deprecated: manifest.deprecated } : manifest;
  const read = (name: string) => {
    if (!docs.has(name)) docs.set(name, registryDocument(name, fetchFn).then(doc => ({ time: doc.time, versions: Object.fromEntries(Object.entries(doc.versions).map(([version, manifest]) => [version, kept(manifest)])) })).catch((error: { status?: number }) => { if (error?.status === 404) return null; throw error; }));
    return docs.get(name)!;
  };
  const planned = new Map<string, string[]>();
  for (const change of input.plan) planned.set(change.name, [...new Set([...(planned.get(change.name) ?? []), change.to])]);
  const published: number[] = [];
  for (const change of input.plan) {
    const at = time((await read(change.name))?.time?.[change.to]);
    if (!Number.isFinite(at)) throw new Error(`The time cap could not be checked: ${change.name}@${change.to} has no publish time, so T is unknown.`);
    published.push(at);
  }
  const { t, note } = resolutionTime(published, input.plan, input.findings);

  const locked = new Map<string, Set<string>>(), lockedIds = new Set<string>();
  for (const [path, item] of Object.entries(readLock(input.baseLock))) {
    if (!path || !isObject(item) || typeof item.version !== "string" || lockKey(path, item) !== "install" || item.link) continue;
    const name = typeof item.name === "string" ? item.name : requireName(path);
    locked.set(name, (locked.get(name) ?? new Set()).add(item.version));
    lockedIds.add(`${name}@${item.version}`);
  }

  // OSV, per version, read once, as next-fix.ts reads it: a record OSV marks withdrawn does not count.
  const named = new Map<string, string[]>(), records = new OsvClient(fetchFn);
  const ask = async (name: string, versions: string[]) => {
    const wanted = versions.filter(version => !named.has(`${name}@${version}`));
    if (!wanted.length) return;
    const found = await osvIds(wanted.map(version => ({ name, version })), fetchFn);
    for (const version of wanted) {
      const ids = found.get(`${name}@${version}`);
      if (!ids) throw new Error(`OSV gave no answer for ${name}@${version}.`);
      const live: string[] = [];
      for (const id of ids) if (!(await records.advisory(id)).withdrawn) live.push(id);
      named.set(`${name}@${version}`, live);
    }
  };
  const identities = new Map<string, ReleaseIdentity | null>();
  const identity = async (name: string, version: string) => {
    const id = `${name}@${version}`;
    if (!identities.has(id)) {
      const fact = (await registryFacts(name, [version], fetchFn)).get(version);
      identities.set(id, fact?.present ? releaseIdentity({ ...fact, malicious: [], advisories: [] }) : null);
    }
    return identities.get(id)!;
  };

  const choose = async ({ name, spec }: Requirement): Promise<Answer> => {
    const requirement = `${name}@${spec}`;
    const excluded: ExclusionCounts = { in_range: 0, no_time: 0, after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0 };
    const none = (reason: string): Answer => ({ requirement, name, version: null, role: null, published_at: null, passed_over: [], excluded, reason });
    if (semver.validRange(spec, { loose: true }) === null) return none(`${plain(spec)} is a tag, which cannot be resolved at T`);
    const doc = await read(name);
    if (!doc) return none("the registry lists no such package");
    const at = (version: string) => time(doc.time[version]);
    const of = (version: string, role: AnswerRole, passed: Answer["passed_over"]): Answer => ({ requirement, name, version, role, published_at: Number.isFinite(at(version)) ? new Date(at(version)).toISOString() : null, passed_over: passed, excluded });
    const v = (planned.get(name) ?? []).find(version => semver.satisfies(version, spec, { loose: true }));
    if (v) return of(v, "v", []);
    const all = [...new Set([...Object.keys(doc.versions), ...Object.keys(doc.time).filter(key => !RESERVED_TIME.has(key))])].filter(version => semver.valid(version, { loose: true }) && semver.satisfies(version, spec, { loose: true }));
    excluded.in_range = all.length;
    const oldestFirst = (a: string, b: string) => (at(a) - at(b)) || semver.compare(a, b, { loose: true });
    const passed: Answer["passed_over"] = [];
    const pass = (version: string, count: keyof ExclusionCounts, reason: string) => { excluded[count]++; if (passed.length < PASSED_OVER_LIMIT) passed.push({ version, reason }); };
    const usable: string[] = [];
    for (const version of [...all].sort((a, b) => semver.compare(a, b, { loose: true }))) {
      if (!Number.isFinite(at(version))) pass(version, "no_time", "the registry gives no publish time");
      else if (!isObject(doc.versions[version])) pass(version, "withdrawn", "no longer listed by the registry");
      else if (typeof doc.versions[version].deprecated === "string" && doc.versions[version].deprecated) pass(version, "deprecated", `deprecated: ${plain(doc.versions[version].deprecated)}`);
      else usable.push(version);
    }
    usable.sort(oldestFirst);
    /** The first in `versions`, oldest first, that OSV names in no record; the rest stay unasked. */
    const firstClean = async (versions: string[], accept: (version: string) => Promise<boolean> = async () => true) => {
      for (let start = 0; start < versions.length; start += OSV_CHUNK) {
        const chunk = versions.slice(start, start + OSV_CHUNK);
        await ask(name, chunk);
        for (const version of chunk) {
          const ids = named.get(`${name}@${version}`)!;
          if (ids.length) pass(version, "advisory", `OSV names it in ${ids.slice(0, 5).join(", ")}`);
          else if (await accept(version)) return version;
        }
      }
      return null;
    };
    const lockedHere = usable.filter(version => locked.get(name)?.has(version));
    const reused = await firstClean(lockedHere);
    if (reused) return of(reused, "reused_base", passed);
    const rest = usable.filter(version => !lockedHere.includes(version));
    const oldest = await firstClean(rest.filter(version => at(version) <= t));
    if (oldest) return of(oldest, "oldest", passed);
    const after = rest.filter(version => at(version) > t);
    excluded.after_t = after.length;
    // V's own range can force a version published just after T: only the same release as V, as rule 1 of the time cap allows.
    if (after.length) {
      const fixes = (await Promise.all(input.plan.map(async change => ({ version: change.to, published: time((await read(change.name))?.time?.[change.to]), identity: await identity(change.name, change.to) })))).filter(f => f.identity);
      const named = excluded.advisory;
      const same = await firstClean(after.slice(0, SAME_RELEASE_LIMIT), async version => {
        const other = await identity(name, version);
        return !!other && fixes.some(f => sameRelease({ version: f.version, published: f.published, identity: f.identity! }, { version, published: at(version), identity: other }, t));
      });
      // Each excluded version is counted once: one OSV names is not also counted as published after T.
      excluded.after_t -= excluded.advisory - named;
      if (same) { excluded.after_t--; return of(same, "same_release", passed); }
    }
    return { ...none(`nothing is left in range: ${excluded.in_range} in range, ${excluded.after_t} published after T, ${excluded.withdrawn} withdrawn, ${excluded.deprecated} deprecated, ${excluded.advisory} named by OSV, ${excluded.no_time} with no publish time`), passed_over: passed };
  };

  const answers: Record<string, Answer> = Object.create(null);
  const seen = new Set<string>();
  let queue: Requirement[] = [];
  const add = (requirement: Requirement) => { const key = keyOf(requirement); if (!seen.has(key)) { seen.add(key); queue.push(requirement); } };
  const final = JSON.parse(input.finalManifest);
  for (const change of input.plan) add({ name: change.name, spec: change.to });
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) if (isObject(final[group])) for (const name of planned.keys()) {
    const own = Object.hasOwn(final[group], name) ? registryRequirement(name, final[group][name]) : null;
    if (own) add(own);
  }
  for (const requirement of overridden(final.overrides)) add(requirement);
  while (queue.length) {
    if (seen.size > limit) throw new Error(`The fix needs more than ${limit} requirements resolved; that needs review.`);
    const batch = queue.slice(0, 8);
    queue = queue.slice(8);
    const chosen = await Promise.all(batch.map(choose));
    for (const answer of chosen) {
      answers[answer.requirement] = answer;
      if (!answer.version) continue;
      const manifest = (await read(answer.name))?.versions?.[answer.version];
      if (isObject(manifest)) for (const requirement of requirementsOf(manifest)) add(requirement);
    }
  }
  return {
    t: new Date(t).toISOString(), t_note: note, answers, v: Object.fromEntries(planned), locked: lockedIds,
    publishedAt: async (name, version) => { const at = time((await read(name))?.time?.[version]); return Number.isFinite(at) ? new Date(at).toISOString() : null; },
  };
}

/** The table as the resolver's container reads it: requirement to version, or null. */
export function tableFile(table: ResolutionTable): string {
  return `${JSON.stringify(Object.fromEntries(Object.entries(table.answers).map(([key, answer]) => [key, answer.version])), null, 2)}\n`;
}

export const RESOLVER_FOLDER = "ludion-resolve";
export const RESOLVER_SCRIPT = `/opt/${RESOLVER_FOLDER}/install.cjs`;
export const RESOLVER_TABLE = "table.json";
const NO_ANSWER = "LUDION_NO_ANSWER";

/**
 * The script that runs the pinned npm's own `install --package-lock-only` with pacote.manifest answering from the table.
 * Short on purpose: it is one line of the Dockerfile, and Docker's error text, which is all the host sees of a failed
 * step, is cut to its end. A question the table has no answer for fails that question: npm decides whether that fails
 * its run, as it does for an optional dependency it can leave out. A Git, URL or file spec goes to npm as before, where
 * its flags refuse it.
 */
export function resolverScript(flags: string[]): string {
  return `"use strict";
const NPM = "/usr/local/lib/node_modules/npm/";
const table = JSON.parse(require("node:fs").readFileSync(__dirname + "/${RESOLVER_TABLE}", "utf8"));
const pacote = require(NPM + "node_modules/pacote"), npa = require(NPM + "node_modules/npm-package-arg");
const manifest = pacote.manifest;
pacote.manifest = async (spec, opts = {}) => {
  const parsed = typeof spec === "string" ? npa(spec) : spec;
  const target = parsed.type === "alias" ? parsed.subSpec : parsed;
  if (!target || !target.registry) return manifest(spec, opts);
  const key = target.name + "@" + (String(target.rawSpec || "*").trim() || "*");
  const version = Object.hasOwn(table, key) ? table[key] : null;
  if (typeof version !== "string") throw Object.assign(new Error("${NO_ANSWER} " + key + " (" + (Object.hasOwn(table, key) ? "nothing allowed" : "not in the table") + ")"), { code: "ELUDIONNOANSWER" });
  return manifest(parsed.type === "alias" ? parsed.name + "@npm:" + target.name + "@" + version : target.name + "@" + version, opts);
};
process.argv = [process.argv[0], NPM + "bin/npm-cli.js", "install", "--package-lock-only", ${flags.map(flag => JSON.stringify(flag)).join(", ")}];
require(NPM + "bin/npm-cli.js");
`;
}

/** Which requirement npm's failed run names, from Docker's error text; the table, not that text, then says why. */
export function noAnswerIn(message: string): string | null {
  const start = message.indexOf(`${NO_ANSWER} `);
  if (start < 0) return null;
  // A range can hold spaces, so the requirement ends where the script's own closing words start.
  const line = message.slice(start + NO_ANSWER.length + 1).split("\n", 1)[0]!;
  const end = Math.max(line.lastIndexOf(" (nothing allowed)"), line.lastIndexOf(" (not in the table)"));
  return end > 0 ? line.slice(0, end) : null;
}

/** Why a fix stops when npm's run failed on a requirement with no answer. */
export function noAnswerReason(table: ResolutionTable, key: string): { reason: string; stopped_no_allowed: boolean } {
  const answer = table.answers[key];
  if (!answer) return { stopped_no_allowed: false, reason: `npm asked for ${plain(key)}, which the table of oldest versions does not hold, so this fix stops rather than take the version npm would pick.` };
  return { stopped_no_allowed: true, reason: `No allowed version for ${plain(key)}: ${answer.reason ?? "no answer"}. This fix stops: no newer or excluded version is taken.` };
}

/**
 * What the receipt keeps of the table: how many requirements it holds, the answers the diff used, and those with none.
 * The whole table can be thousands of rows, and a receipt over deliver.ts's limit refuses every fix of its run.
 */
export function fixResolution(table: ResolutionTable, diff: { name: string; to: string }[] = []): FixResolution {
  const answers = Object.values(table.answers);
  const used = answers.filter(a => a.version !== null && diff.some(c => c.name === a.name && c.to === a.version));
  return { t: table.t, t_note: table.t_note, requirements: answers.length, answers: [...used, ...answers.filter(a => a.version === null)].slice(0, RECEIPT_ANSWERS), stopped_no_allowed: false };
}

/**
 * The asserts (the decision, section 3), on the diff as npm wrote it. `changes` are the judge's: every install path whose
 * package or version changes. The wait is the judge's for this diff.
 */
export function resolutionAssert(input: { table: ResolutionTable; changes: { path: string; name: string; to: string }[]; waitHours: number; pushedAt: Date; published: (name: string, version: string) => string | null | undefined }): ResolutionAssert {
  const pushed = input.pushedAt.getTime(), wait = input.waitHours * HOUR, t = Date.parse(input.table.t);
  const resolved = Math.min(t, pushed - wait);
  const answers = Object.values(input.table.answers);
  const versions: AssertedVersion[] = [], waits: string[] = [], problems: string[] = [];
  let youngest: { id: string; at: number } | null = null;
  for (const c of input.changes) {
    const id = `${c.name}@${c.to}`;
    const role = input.table.v[c.name]?.includes(c.to) ? "v" : answers.find(a => a.name === c.name && a.version === c.to)?.role ?? (input.table.locked.has(id) ? "reused_base" : null);
    const raw = input.published(c.name, c.to), at = time(raw);
    versions.push({ path: c.path, name: c.name, version: c.to, role, published_at: Number.isFinite(at) ? new Date(at).toISOString() : null, age_hours: Number.isFinite(at) ? Math.round((pushed - at) / HOUR * 10) / 10 : null });
    if (role === null) problems.push(`${id} at ${c.path} is not a version the table of oldest versions gave for ${c.name}.`);
    if (!Number.isFinite(at)) { problems.push(`${id} at ${c.path} has no publish time, so its age cannot be checked.`); continue; }
    if (!youngest || at > youngest.at) youngest = { id, at };
    if (at + wait > pushed) waits.push(`${id} (published ${new Date(at).toISOString()}) is younger than the wait of ${input.waitHours}h.`);
    // Rule (b): what the resolution may have seen. V is itself, a locked version brings in no new code, and the same
    // release as V is the one allowance after T.
    if (role === "oldest" && at > t) problems.push(`${id} at ${c.path} was published after T (${input.table.t}).`);
  }
  return {
    t: input.table.t, pushed_at: input.pushedAt.toISOString(), wait_hours: input.waitHours, resolved_at: new Date(resolved).toISOString(),
    t_before_push_less_wait: t <= pushed - wait,
    youngest: youngest?.id ?? null, wait_until: youngest ? new Date(youngest.at + wait).toISOString() : null,
    versions, waits, problems,
  };
}

/** A path that changed without need; `to` is null when it went away. */
export type UnneededMove = { path: string; name: string; from: string; to: string | null };

const installs = (lock: Record<string, any>) => new Map(Object.entries(lock).filter(([path, item]) => path !== "" && isObject(item) && lockKey(path, item) === "install" && !item.link));
const packageAt = (path: string, item: Record<string, any>): string => typeof item.name === "string" ? item.name : requireName(path);
/** Each package in a lock that loads `path` for the name at its end, by Node's lookup, with the spec it writes. An optional peer is not one. */
function loadersOf(lock: Record<string, any>, map: Map<string, any>, path: string): { at: string; spec: unknown }[] {
  const name = requireName(path), target = map.get(path), out: { at: string; spec: unknown }[] = [];
  for (const [at, item] of Object.entries(lock)) {
    if (!isObject(item) || item.link || (at !== "" && lockKey(at, item) !== "install")) continue;
    const meta = isObject(item.peerDependenciesMeta) ? item.peerDependenciesMeta : {};
    const groups = at === "" ? ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] : ["dependencies", "optionalDependencies", "peerDependencies"];
    for (const group of groups) {
      if (!isObject(item[group]) || !Object.hasOwn(item[group], name)) continue;
      if (group === "peerDependencies" && Object.hasOwn(meta, name) && meta[name]?.optional === true) continue;
      if (resolveFrom(map, at ? `${at}/` : "", name) === target) out.push({ at, spec: item[group][name] });
    }
  }
  return out;
}

/** A version the fix brings in that no package loading it would get from the table. */
export type NotOldest = { path: string; name: string; version: string; requirements: string[]; answers: string[] };

/**
 * Versions in the diff that are not the table's answer for a requirement of a package that loads them: every path that
 * moved or was added, other than V and a version the base already locks, which brings in no new code. Per requirement, so
 * a version the table gives for another range of the name is no answer here. Read in `ludion patch` and, from a table it
 * works out itself, in the PR job.
 */
export function notOldest(table: Pick<ResolutionTable, "answers" | "v">, beforeLock: string, afterLock: string, finalManifest: string): NotOldest[] {
  const was = readLock(beforeLock), is = readLock(afterLock), before = installs(was), after = installs(is);
  const locked = new Set([...before].map(([path, item]) => `${packageAt(path, item)}@${item.version}`));
  const overrides = overridden(JSON.parse(finalManifest).overrides);
  const out: NotOldest[] = [];
  for (const [path, item] of after) {
    const name = packageAt(path, item), version = String(item.version);
    if (before.get(path)?.version === version && packageAt(path, before.get(path)) === name) continue;
    if (table.v[name]?.includes(version) || locked.has(`${name}@${version}`)) continue;
    const requirements = [...new Set([
      ...loadersOf(is, after, path).map(loader => registryRequirement(requireName(path), loader.spec)).filter((r): r is Requirement => !!r && r.name === name),
      ...overrides.filter(r => r.name === name),
    ].map(keyOf))];
    const answers = requirements.map(key => table.answers[key]?.version ?? null);
    if (!answers.includes(version)) out.push({ path, name, version, requirements, answers: answers.filter((a): a is string => a !== null) });
  }
  return out;
}

/**
 * The PR job's own reading (the decision, section 5): nothing in the artifact counts. From the lockfiles Ludion checked,
 * the registry's metadata and OSV alone, the table is worked out again and every new version held against it. The fix's
 * advisories are OSV's: those on the version moved from that do not name the version moved to, as the judge reads them.
 * Only names and versions, and back to OSV the IDs it returned, are sent, and no package's code is run. Returns why the
 * fix is refused, or null. A read that fails throws. A fix that brings in nothing new reads nothing.
 */
export async function recheckOldest(input: { plan: { name: string; from: string; to: string }[]; beforeLock: string; afterLock: string; finalManifest: string; fetchFn?: typeof fetch }): Promise<string | null> {
  const fetchFn = input.fetchFn ?? fetch;
  const possible = notOldest({ answers: {}, v: Object.fromEntries(input.plan.map(c => [c.name, input.plan.filter(o => o.name === c.name).map(o => o.to)])) }, input.beforeLock, input.afterLock, input.finalManifest);
  if (!possible.length) return null;
  const ids = await osvIds(input.plan.flatMap(c => [{ name: c.name, version: c.from }, { name: c.name, version: c.to }]), fetchFn);
  const records = new OsvClient(fetchFn), findings: Finding[] = [];
  const plan: Change[] = [];
  for (const change of input.plan) {
    const after = new Set(ids.get(`${change.name}@${change.to}`) ?? []);
    const closed = (ids.get(`${change.name}@${change.from}`) ?? []).filter(id => !after.has(id));
    const live: string[] = [];
    for (const id of closed) {
      const advisory = await records.advisory(id);
      if (advisory.withdrawn) continue;
      live.push(id);
      findings.push({ package: { ecosystem: "npm", name: change.name, version: change.from, direct: false }, advisory });
    }
    plan.push({ name: change.name, from: change.from, to: change.to, advisories: live });
  }
  const table = await resolveOldest({ plan, baseLock: input.beforeLock, finalManifest: input.finalManifest, findings, fetchFn });
  const wrong = notOldest(table, input.beforeLock, input.afterLock, input.finalManifest);
  if (!wrong.length) return null;
  return `package-lock.json has ${wrong.slice(0, 3).map(w => `${plain(w.name)}@${plain(w.version)} at ${plain(w.path)}, where the oldest version in range for ${plain(w.requirements.join(", ")) || "no requirement"} is ${plain(w.answers.join(", ")) || "none"}`).join("; ")}${wrong.length > 3 ? ` (${wrong.length - 3} more)` : ""}.`;
}

/** Whether a spec takes a version; null when it is not a semver range (a tag, Git, a URL), so it cannot be shown either way. */
function takes(rawSpec: unknown, name: string, version: string): boolean | null {
  const requirement = registryRequirement(name, rawSpec);
  if (!requirement || semver.validRange(requirement.spec, { loose: true }) === null) return null;
  return semver.satisfies(version, requirement.spec, { loose: true });
}

/**
 * Paths other than the fix's own that changed without need: moved although every package that loads them still takes the
 * old version, or removed although nothing the fix changed loaded them. A version already locked does not move while it
 * satisfies its range, so a move is allowed only when the old version fails a requirement of a package that loads the
 * path in the result, and a removal only when every package that loaded the path has moved or gone (the decision,
 * section 2). `ludion patch` and the PR job both read this.
 */
export function unneededMoves(beforeLock: string, afterLock: string, plan: { name: string; from: string }[]): UnneededMove[] {
  const was = readLock(beforeLock), is = readLock(afterLock);
  const before = installs(was), after = installs(is);
  const planned = (path: string, item: Record<string, any>) => plan.some(change => change.name === packageAt(path, item) && change.from === item.version);
  const problems: UnneededMove[] = [];
  for (const [path, item] of before) {
    if (planned(path, item)) continue;
    const now = after.get(path), name = packageAt(path, item), from = String(item.version);
    const move: UnneededMove = { path, name, from, to: now ? String(now.version) : null };
    if (now && now.version === item.version && packageAt(path, now) === name) continue;
    // Another package at this path is no move of this one.
    if (now && packageAt(path, now) !== name) { problems.push(move); continue; }
    if (now) {
      if (!loadersOf(is, after, path).some(loader => takes(loader.spec, name, from) === false)) problems.push(move);
      continue;
    }
    // Gone: only when something loaded it, and everything that did has moved or gone too. The project itself stays.
    const had = loadersOf(was, before, path);
    if (!had.length || had.some(({ at }) => at === "" || after.get(at)?.version === was[at]?.version)) problems.push(move);
  }
  return problems;
}
