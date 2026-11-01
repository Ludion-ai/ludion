// LOLD: writes the lockfile by the rule in ../definitions.md, section 4, with npm 12.2.1's own Arborist. Only the
// answer to "which version for this range?" is replaced (pacote.manifest). Placement, peer sets, flags and the
// lockfile writer stay npm's. No tarball is fetched: pacote.extract and pacote.tarball throw.
// Usage (Docker only): node oldest.mjs <project dir> <job.json>
// job: { name, from, v, t, pinnedManifest, finalManifest, baseLock, out }
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire("/vol/npm12/node_modules/npm/package.json");
const semver = require("semver");
const npa = require("npm-package-arg");
const pacote = require("pacote");
const Arborist = require("@npmcli/arborist");

const REGISTRY = "https://registry.npmjs.org/";
const [dir, jobPath] = process.argv.slice(2);
const job = JSON.parse(readFileSync(jobPath, "utf8"));
const T = Date.parse(job.t);
// Diagnostic arms only, added after the result (README): unset in the run that gives the answer.
const IGNORE = new Set((process.env.LOLD_IGNORE ?? "").split(",").filter(Boolean));

const report = { picks: [], stops: [], read_errors: [], tarball_requests: [], other_specs: [] };

const packageName = (path, entry) => entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
const baseVersions = new Map();
for (const [path, entry] of Object.entries(JSON.parse(readFileSync(job.baseLock, "utf8")).packages)) {
  if (!path || !entry.version) continue;
  const name = packageName(path, entry);
  if (!baseVersions.has(name)) baseVersions.set(name, new Set());
  baseVersions.get(name).add(entry.version);
}

const originalManifest = pacote.manifest;
const originalPackument = pacote.packument;
const refuse = kind => async spec => {
  report.tarball_requests.push(`${kind}: ${String(spec)}`);
  throw Object.assign(new Error(`LOLD: ${kind} refused for ${String(spec)}`), { code: "LOLD_TARBALL" });
};
pacote.extract = refuse("extract");
pacote.tarball = refuse("tarball");

const facts = new Map();
/** Today's packument at T, and every version's reason to be excluded. */
async function factsAtT(name, opts) {
  if (facts.has(name)) return facts.get(name);
  const promise = (async () => {
    const doc = await originalPackument(name, { ...opts, fullMetadata: true, before: undefined });
    const time = doc.time ?? {};
    const listed = doc.versions ?? {};
    const all = new Set([...Object.keys(listed), ...Object.keys(time).filter(k => semver.valid(k, { loose: true }))]);
    const atT = [...all].filter(version => version in time && Date.parse(time[version]) <= T);
    const advisories = [];
    for (let i = 0; i < atT.length; i += 500) {
      const res = await fetch(`${REGISTRY}-/npm/v1/security/advisories/bulk`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ [name]: atT.slice(i, i + 500) }),
      });
      if (!res.ok) throw Object.assign(new Error(`advisory endpoint answered ${res.status} for ${name}`), { code: "LOLD_READ" });
      const body = await res.json();
      advisories.push(...(body[name] ?? []));
    }
    const ranges = [...new Set(advisories.map(a => a.vulnerable_versions).filter(Boolean))];
    const info = new Map();
    for (const version of all) {
      let reason = null;
      if (!(version in time)) reason = "no_time";
      else if (Date.parse(time[version]) > T) reason = "after_t";
      else if (!(version in listed)) reason = "withdrawn";
      else if (listed[version].deprecated && !IGNORE.has("deprecated")) reason = "deprecated";
      else if (!IGNORE.has("advisory") && ranges.some(range => semver.satisfies(version, range, { loose: true }))) reason = "advisory";
      info.set(version, { reason, time: time[version] ? Date.parse(time[version]) : null });
    }
    return info;
  })();
  facts.set(name, promise);
  return promise;
}

const byAge = info => (a, b) => (info.get(a).time - info.get(b).time) || semver.compare(a, b, { loose: true });

/** The version the rule takes for name@range, or null with the counts when none is left. */
async function choose(name, range, opts) {
  const info = await factsAtT(name, opts);
  const inRange = [...info.keys()].filter(version => semver.satisfies(version, range, { loose: true }));
  const counts = { in_range: inRange.length, no_time: 0, after_t: 0, withdrawn: 0, deprecated: 0, advisory: 0 };
  const allowed = [];
  for (const version of inRange) {
    const { reason } = info.get(version);
    if (reason) counts[reason]++;
    else allowed.push(version);
  }
  const locked = allowed.filter(version => baseVersions.get(name)?.has(version));
  const pool = locked.length ? locked : allowed;
  if (!pool.length) return { version: null, counts };
  return { version: [...pool].sort(byAge(info))[0], reused_base: locked.length > 0, counts, published: new Date(info.get([...pool].sort(byAge(info))[0]).time).toISOString() };
}

pacote.manifest = async (spec, opts = {}) => {
  const parsed = typeof spec === "string" ? npa(spec) : spec;
  const target = parsed.type === "alias" ? parsed.subSpec : parsed;
  if (!target?.registry || !["range", "version", "tag"].includes(target.type)) {
    report.other_specs.push(String(parsed.raw));
    return originalManifest(spec, opts);
  }
  const exact = version => (parsed.type === "alias" ? `${parsed.name}@npm:${target.name}@${version}` : `${target.name}@${version}`);
  const req = `${target.name}@${target.rawSpec}`;
  if (target.name === job.name && semver.satisfies(job.v, target.fetchSpec, { loose: true })) {
    report.picks.push({ req, picked: job.v, is_v: true });
    return originalManifest(exact(job.v), { ...opts, before: undefined });
  }
  if (target.type === "tag") {
    report.stops.push({ req, reason: "tag" });
    throw Object.assign(new Error(`LOLD: ${req} is a tag`), { code: "LOLD_STOP" });
  }
  let chosen;
  try {
    chosen = await choose(target.name, target.fetchSpec, opts);
  } catch (error) {
    report.read_errors.push(`${req}: ${error.message}`);
    throw error;
  }
  if (!chosen.version) {
    report.stops.push({ req, reason: "no_allowed", counts: chosen.counts });
    throw Object.assign(new Error(`LOLD: nothing allowed for ${req}`), { code: "LOLD_STOP" });
  }
  report.picks.push({ req, picked: chosen.version, reused_base: chosen.reused_base, published: chosen.published, counts: chosen.counts });
  return originalManifest(exact(chosen.version), { ...opts, before: undefined });
};

async function step(manifest) {
  writeFileSync(join(dir, "package.json"), manifest);
  const arb = new Arborist({
    path: dir, registry: REGISTRY, cache: "/vol/cache/_cacache", ignoreScripts: true, audit: false, fund: false,
    packageLockOnly: true, allowGit: "none", allowRemote: "none", allowFile: "none", allowDirectory: "none",
    nodeVersion: process.version, npmVersion: "12.2.1",
  });
  await arb.reify({ packageLockOnly: true, ignoreScripts: true, audit: false, fund: false });
}

let failure = null;
try {
  await step(readFileSync(job.pinnedManifest, "utf8"));
  await step(readFileSync(job.finalManifest, "utf8"));
} catch (error) {
  failure = { code: error.code ?? null, message: String(error.message).slice(0, 2000) };
}
writeFileSync(job.out, JSON.stringify({ ...report, failure }, null, 2) + "\n");
process.exit(0);
