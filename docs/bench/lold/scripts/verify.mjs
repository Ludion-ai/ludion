// LOLD: the checks of ../definitions.md, section 7, on lockfiles read as plain JSON. It reads packuments and the
// advisory endpoint on its own with fetch and shares no code with oldest.mjs, apart from semver.
import { createRequire } from "node:module";

const require = createRequire("/vol/npm12/node_modules/npm/package.json");
const semver = require("semver");
const REGISTRY = "https://registry.npmjs.org";
const LOOSE = { loose: true };
// Diagnostic arms only, added after the result (README): unset in the run that gives the answer.
const IGNORE = new Set((process.env.LOLD_IGNORE ?? "").split(",").filter(Boolean));

const docs = new Map();
export async function times(name) {
  if (docs.has(name)) return docs.get(name);
  const promise = (async () => {
    const res = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`registry answered ${res.status} for ${name}`);
    const doc = await res.json();
    const versions = {};
    for (const [version, manifest] of Object.entries(doc.versions ?? {})) versions[version] = { deprecated: Boolean(manifest.deprecated) };
    return { time: doc.time ?? {}, versions };
  })();
  docs.set(name, promise);
  return promise;
}

const advisoryCache = new Map();
async function advisoryRanges(name, versions, key) {
  const cacheKey = `${name}\0${key}`;
  if (advisoryCache.has(cacheKey)) return advisoryCache.get(cacheKey);
  const ranges = new Set();
  for (let i = 0; i < versions.length; i += 500) {
    const res = await fetch(`${REGISTRY}/-/npm/v1/security/advisories/bulk`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [name]: versions.slice(i, i + 500) }),
    });
    if (!res.ok) throw new Error(`advisory endpoint answered ${res.status} for ${name}`);
    for (const a of (await res.json())[name] ?? []) if (a.vulnerable_versions) ranges.add(a.vulnerable_versions);
  }
  advisoryCache.set(cacheKey, [...ranges]);
  return [...ranges];
}

export const nameAt = (path, entry) => entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);

function parentOf(path) {
  const i = path.lastIndexOf("/node_modules/");
  if (i >= 0) return path.slice(0, i);
  return path.startsWith("node_modules/") ? "" : null;
}

/** Node's lookup: the nearest node_modules holding `dep`, from the package at `from`. */
export function lookup(packages, from, dep) {
  for (let at = from; at !== null; at = parentOf(at)) {
    const candidate = at ? `${at}/node_modules/${dep}` : `node_modules/${dep}`;
    if (packages[candidate]) return candidate;
  }
  return null;
}

/** A spec as a registry range and the package it names, or null for anything else. */
function rangeOf(dep, spec) {
  const alias = /^npm:((?:@[^/]+\/)?[^@]+)(?:@(.*))?$/.exec(spec);
  if (alias) return { name: alias[1], range: alias[2] || "*" };
  return semver.validRange(spec, LOOSE) === null ? null : { name: dep, range: spec };
}

/** For each path, the ranges of every package that loads it, by Node's lookup. */
export function dependents(packages) {
  const out = new Map();
  for (const [path, entry] of Object.entries(packages)) {
    const groups = [entry.dependencies, entry.optionalDependencies, entry.peerDependencies];
    if (path === "") groups.push(entry.devDependencies);
    for (const group of groups) {
      for (const [dep, spec] of Object.entries(group ?? {})) {
        const at = lookup(packages, path, dep);
        const parsed = rangeOf(dep, spec);
        if (!at || !parsed) continue;
        if (!out.has(at)) out.set(at, []);
        out.get(at).push({ from: path, range: parsed.range });
      }
    }
  }
  return out;
}

export function diff(base, result) {
  const a = base.packages, b = result.packages;
  const added = [], moved = [], removed = [], flagsOnly = [];
  for (const path of Object.keys(b)) {
    if (!path) continue;
    if (!a[path]) added.push(path);
    else if (a[path].version !== b[path].version) moved.push(path);
    else if (["dev", "optional", "devOptional", "peer"].some(flag => Boolean(a[path][flag]) !== Boolean(b[path][flag]))) flagsOnly.push(path);
  }
  for (const path of Object.keys(a)) if (path && !b[path]) removed.push(path);
  return { added, moved, removed, flagsOnly };
}

export function duplicates(lock) {
  const seen = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = nameAt(path, entry);
    if (!seen.has(name)) seen.set(name, new Set());
    seen.get(name).add(entry.version);
  }
  return [...seen.entries()].filter(([, versions]) => versions.size > 1).map(([name, versions]) => `${name}: ${[...versions].sort().join(", ")}`);
}

export function versionsMoved(base, result, adv) {
  const { added, moved } = diff(base, result);
  return [...added, ...moved].map(path => ({ path, name: nameAt(path, result.packages[path]), to: result.packages[path].version, from: base.packages[path]?.version ?? null }))
    .filter(item => !(item.name === adv.name && item.to === adv.v));
}

/** The checks I1 to I4, and the list of non-V versions with their facts. */
export async function checkOldest(base, result, adv) {
  const T = Date.parse(adv.t);
  const failures = [];
  const packages = result.packages;

  // I1
  for (const [path, entry] of Object.entries(packages)) {
    if (path && nameAt(path, entry) === adv.name && semver.satisfies(entry.version, adv.vulnerable, LOOSE)) failures.push(`I1: ${path} still holds ${entry.version}`);
  }
  for (const [path, entry] of Object.entries(base.packages)) {
    if (path && nameAt(path, entry) === adv.name && semver.satisfies(entry.version, adv.vulnerable, LOOSE) && packages[path]?.version !== adv.v) failures.push(`I1: ${path} was ${entry.version} and is now ${packages[path]?.version ?? "absent"}, not V`);
  }

  // V's own publish time, for the assert
  const vDoc = await times(adv.name);
  const vTime = vDoc.time[adv.v];
  if (!vTime || Date.parse(vTime) > T) failures.push(`I2: V ${adv.v} published ${vTime ?? "unknown"}, after T`);

  const baseVersions = new Map();
  for (const [path, entry] of Object.entries(base.packages)) {
    if (!path) continue;
    const name = nameAt(path, entry);
    if (!baseVersions.has(name)) baseVersions.set(name, new Set());
    baseVersions.get(name).add(entry.version);
  }

  const loaders = dependents(packages);
  const items = [];
  for (const item of versionsMoved(base, result, adv)) {
    const doc = await times(item.name);
    const published = doc.time[item.to] ?? null;
    const time = published ? Date.parse(published) : null;

    // I2, the assert
    const beforeT = time !== null && time <= T;
    if (!beforeT) failures.push(`I2: ${item.path} ${item.to} published ${published ?? "unknown"}, after T`);

    // I3
    const atT = Object.keys(doc.time).filter(v => semver.valid(v, LOOSE) && Date.parse(doc.time[v]) <= T);
    const ranges = await advisoryRanges(item.name, atT, adv.t);
    const excludedBecause = version => {
      if (!(version in doc.versions)) return "withdrawn";
      if (doc.versions[version].deprecated && !IGNORE.has("deprecated")) return "deprecated";
      if (!IGNORE.has("advisory") && ranges.some(range => semver.satisfies(version, range, LOOSE))) return "advisory";
      return null;
    };
    const wanted = (loaders.get(item.path) ?? []).map(d => d.range);
    const allowed = atT.filter(v => !excludedBecause(v) && wanted.every(range => semver.satisfies(v, range, LOOSE)));
    const age = (x, y) => (Date.parse(doc.time[x]) - Date.parse(doc.time[y])) || semver.compare(x, y, LOOSE);
    const locked = allowed.filter(v => baseVersions.get(item.name)?.has(v));
    const expected = [...(locked.length ? locked : allowed)].sort(age)[0] ?? null;
    const oldest = wanted.length > 0 && expected === item.to;
    const reused = baseVersions.get(item.name)?.has(item.to) ?? false;
    if (!oldest) failures.push(`I3: ${item.path} is ${item.to}; the rule gives ${expected ?? "nothing"} for [${wanted.join(" ; ")}]`);

    // I4
    if (item.from) {
      const stillFine = wanted.length > 0 && wanted.every(range => semver.satisfies(item.from, range, LOOSE));
      if (stillFine) failures.push(`I4: ${item.path} moved ${item.from} -> ${item.to} though ${item.from} satisfies [${wanted.join(" ; ")}]`);
    }

    const entry = packages[item.path];
    items.push({
      path: item.path, name: item.name, from: item.from, to: item.to, published,
      age_at_t_hours: time === null ? null : Math.round((T - time) / 36e4) / 10,
      oldest, reused_base: reused, excluded_reason_of_to: excludedBecause(item.to),
      ranges: wanted, has_install_script: Boolean(entry.hasInstallScript),
      engines_not_node24: Boolean(entry.engines?.node && !semver.satisfies(process.version, entry.engines.node, LOOSE)),
      flags: ["dev", "optional", "devOptional", "peer"].filter(flag => entry[flag]),
    });
  }
  return { items, failures, v_published: vTime ?? null };
}

/** The youngest version among a lockfile's non-V moves, measured from `at` (ms), and how many came after T. */
export async function ages(base, result, adv, at) {
  const T = Date.parse(adv.t);
  let youngest = null, afterT = 0, unknown = 0;
  const moved = versionsMoved(base, result, adv);
  for (const item of moved) {
    const doc = await times(item.name);
    const published = doc.time[item.to];
    if (!published) { unknown++; continue; }
    const hours = Math.round((at - Date.parse(published)) / 36e4) / 10;
    if (youngest === null || hours < youngest.hours) youngest = { hours, version: `${item.name}@${item.to}`, published };
    if (Date.parse(published) > T) afterT++;
  }
  return { versions_moved: moved.length, youngest_age: youngest, published_after_t: afterT, publish_time_unknown: unknown };
}

/** Paths at which two lockfiles differ, over the union of paths either moved from the base. */
export function differingPaths(base, one, other) {
  const a = diff(base, one), b = diff(base, other);
  const union = new Set([...a.added, ...a.moved, ...a.removed, ...b.added, ...b.moved, ...b.removed]);
  return [...union].filter(path => one.packages[path]?.version !== other.packages[path]?.version);
}
