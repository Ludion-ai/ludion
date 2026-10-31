// The judge (docs/design.md, "判定役 v0"): given an npm lockfile change, may it be applied, and when?
// Pure: every fact comes in as data (registry, OSV, KEV), so the same rules run live and in the backtest.
// v0 judges gates 1, 2 and 4 and the wait. Gate 3 (build and test) is not run here, so v0 never says "apply".
import semver from "semver";
import { eventProblem, renderTimeCap, repositoryIds, timeCap, type Provenance, type ReleaseIdentity, type TimeCap } from "./time-cap.ts";

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
  /** The publisher counts as no account (npm-facts.ts, sharedPublisher): trusted publishing's shared user, say. */
  shared_publisher: boolean;
  /** Build provenance from the registry's attestations: null when the version has none. */
  provenance: Provenance | null;
  /** Which of preinstall, install, postinstall the version declares. */
  install_scripts: string[];
  dependencies: string[];
  /** The registry's sha512 integrity for the version's tarball. */
  integrity: string | null;
  /** When the package itself first appeared (time-cap.ts, firstPublish); absent when not read. */
  package_created?: string | null;
  /** OSV MAL- records naming this version. */
  malicious: string[];
  /** Other OSV advisories (vulnerabilities) naming this version. */
  advisories: string[];
};

/** What the same-release exception compares for a version: a shared publisher is no account, so unknown. */
export const releaseIdentity = (f: VersionFacts): ReleaseIdentity => ({ publisher: f.shared_publisher ? null : f.publisher, provenance: f.provenance });

/** The registry's own tarball URL for a version: the only `resolved` the judge accepts. */
export function registryTarball(name: string, version: string): string {
  return `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
}

/**
 * A known advisory the change fixes, with what is known about its urgency: `from` had the advisory and `to`, the
 * version it changed to, does not. `epss_date` is the score_date of the EPSS list its CVE ids were looked up in (null
 * when the list gives none); it is absent when no list was read for it.
 */
export type FixedAdvisory = { id: string; package: string; from: string; to: string; aliases: string[]; severity: string | null; kev: boolean; epss: number | null; epss_date?: string | null };

/**
 * The fixes that count as the change's own: per advisory, package and vulnerable version, the smallest version it
 * changed to. A larger one reached the same way (a dependent that now loads a newer nested copy, say) is a passenger:
 * it neither sets T, anchors a sibling nor dates the exposure, and rule 1 checks it like any other version. (Urgency
 * still counts it: see urgencyOf.)
 */
export function ownFixes(fixes: FixedAdvisory[]): FixedAdvisory[] {
  const smallest = new Map<string, FixedAdvisory>();
  for (const f of fixes) {
    const key = `${f.id}\0${f.package}\0${f.from}`, s = smallest.get(key);
    if (!s || semver.lt(f.to, s.to)) smallest.set(key, f);
  }
  return fixes.filter(f => smallest.get(`${f.id}\0${f.package}\0${f.from}`)!.to === f.to);
}
const fixedBy = (fixes: FixedAdvisory[]) => { const own = new Set(ownFixes(fixes).map(f => `${f.package}@${f.to}`)); return (c: Change) => own.has(`${c.name}@${c.to}`); };

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
  /** Rules 1 and 2 (docs/decisions.md, "Moving dependencies are capped at the fix's publish time"). */
  time_cap: TimeCap;
  not_checked: string[];
};

const LIFECYCLE = ["preinstall", "install", "postinstall"];
export function installScripts(scripts: unknown): string[] {
  if (!scripts || typeof scripts !== "object") return [];
  return LIFECYCLE.filter(name => typeof (scripts as Record<string, unknown>)[name] === "string");
}

/** The top-level keys npm writes in a package-lock v2/v3; any other is refused. */
const LOCK_KEYS = new Set(["name", "version", "lockfileVersion", "requires", "packages", "dependencies"]);

/**
 * The `packages` section of a package-lock v2/v3, after checking that every npm installs the same tree from the file.
 * The judge and the PR job (deliver.ts) read package-lock.json only through this (reviews of aa5d75b and 1e6f705).
 * - lockfileVersion 2 or 3 only, and no top-level key npm does not write.
 * - A v2 lock holds the tree twice: `packages` (npm 7 and later) and the nested `dependencies` tree (npm 6). The two
 *   views must say the same at every install path, under a closed list of the tree's keys.
 * Anything else throws. Whether the lock meets its own requirements is a comparison with the base: newUnmetRequirements.
 */
export function readLock(lockText: string): Record<string, any> {
  const { top } = lockViews(lockText);
  return top.packages;
}

/** The parsed lock and its views: `packages`, and the npm 6 tree when npm 6 reads one (else null). */
function lockViews(lockText: string): { top: Record<string, any>; packagesView: Map<string, ViewEntry>; treeView: Map<string, ViewEntry> | null } {
  const lock: unknown = JSON.parse(lockText);
  if (!isPlain(lock)) throw new Error("package-lock.json is not an object.");
  const top = lock as Record<string, any>;
  if (!isPlain(top.packages) || (top.lockfileVersion !== 2 && top.lockfileVersion !== 3)) throw new Error("The judge reads package-lock v2/v3 only.");
  const unknown = Object.keys(top).filter(key => !LOCK_KEYS.has(key));
  if (unknown.length) throw new Error(`package-lock.json has a top-level key npm does not write: ${unknown.slice(0, 3).join(", ")}.`);
  const packagesView = viewOfPackages(top.packages);
  // npm 6 reads the tree of a v2 lock (none at all means it installs nothing from the lock), and of any lock that has one.
  if (top.lockfileVersion === 3 && top.dependencies === undefined) return { top, packagesView, treeView: null };
  const treeView = viewOfTree(top.packages, top.dependencies);
  for (const path of new Set([...packagesView.keys(), ...treeView.keys()])) {
    const a = packagesView.get(path)?.key, b = treeView.get(path)?.key;
    if (a !== b) throw new Error(`package-lock.json's packages and its npm 6 dependencies tree disagree at ${path}: ${a === undefined ? "only the dependencies tree has it" : b === undefined ? "only packages has it" : `${a.replaceAll("\0", " ")} against ${b.replaceAll("\0", " ")}`}.`);
  }
  return { top, packagesView, treeView };
}

/**
 * The requirements a lock leaves unmet (requirementsMet), in each view npm reads, keyed so that the same unmet
 * requirement in two locks has the same key. `manifest` is the project's package.json: its `overrides` count in the
 * `packages` view (npm 7 and later), not in the npm 6 tree (npm 6 does not read them).
 */
export function unmetRequirements(lockText: string, manifest?: unknown): Map<string, string> {
  const { top, packagesView, treeView } = lockViews(lockText);
  const project = isPlain(manifest) ? manifest : {};
  return new Map([
    ...(treeView ? requirementsMet(treeView, [], "npm 6 dependencies tree", undefined, project) : []),
    ...requirementsMet(packagesView, projects(top.packages), "packages", project.overrides, project),
  ]);
}

/**
 * The requirements "after" leaves unmet that "before" did not (docs/decisions/2026-10-31-lock-requirements-against-the-base.md):
 * npm `install` fetches from the registry, unpinned, whatever a lock leaves missing or outside its range, so a change
 * that adds such a requirement is refused (reviews of ebfe89d, B1). One the base already has (a `--legacy-peer-deps`
 * lock) is the project's own. `ludion judge`, npm `patch`'s judge and the PR job all ask this.
 */
export function newUnmetRequirements(before: { lock: string; manifest?: unknown }, after: { lock: string; manifest?: unknown }): string[] {
  const had = unmetRequirements(before.lock, before.manifest);
  return [...unmetRequirements(after.lock, after.manifest)].filter(([key]) => !had.has(key)).map(([, message]) => message);
}

const isPlain = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The keys of an entry of the npm 6 `dependencies` tree, a closed list; any other is refused. npm 7 to 11 write
 * `devOptional` and `peer` there too (the npm corpus, docs/decisions/2026-10-31-lock-corpus-against-npm.md; review
 * 6533374683, B1).
 */
const TREE_KEYS = new Set(["version", "resolved", "integrity", "dev", "optional", "devOptional", "peer", "bundled", "requires", "dependencies"]);
/** The flags both views carry, as the tree names them (`packages` calls `bundled` `inBundle`); absent means false. */
const TREE_FLAGS = ["dev", "optional", "devOptional", "peer", "bundled"];

/**
 * One install path as a view says it. `key` is what the two views compare: "version\0resolved\0integrity\0flags\0requires".
 * `name` and `version` are the package a requirement finds there (an alias's real name; a link's folder's), `dir` is
 * where its own requirements are looked up from, and `needs` are those requirements as [name, spec]; `peers` names the
 * ones that are peers.
 */
type ViewEntry = { path: string; key: string; name: string; version: string; link: boolean; dir: string; needs: [string, string][]; peers?: Set<string>; optional?: Set<string> };

/** `peerDependencies` that `peerDependenciesMeta` does not mark optional, which npm 7 and later install. */
function requiredPeers(item: Record<string, any>): [string, string][] {
  const meta = isPlain(item.peerDependenciesMeta) ? item.peerDependenciesMeta : {};
  return requirementList(item.peerDependencies).filter(([name]) => !(isPlain(meta[name]) && meta[name].optional === true));
}

/**
 * The optional peers (`peerDependenciesMeta` marks them optional) that no other of the entry's groups names (npm's
 * other edges replace a peer's, node.js `_loadDeps`). npm installs none, and one Node's lookup finds must still be the
 * package its spec names, in range, as `npm ls` and npm 12.2.1's ERESOLVE hold it (audit 6541743253, item 1;
 * docs/decisions/2026-10-31-lock-flags-from-graph.md, section 1).
 */
function optionalPeers(item: Record<string, any>, others: [string, string][]): [string, string][] {
  const meta = isPlain(item.peerDependenciesMeta) ? item.peerDependenciesMeta : {}, named = new Set(others.map(([name]) => name));
  return requirementList(item.peerDependencies).filter(([name]) => isPlain(meta[name]) && meta[name].optional === true && !named.has(name));
}

/**
 * The names an installed lock entry requires, which npm installs for it: `dependencies`, `optionalDependencies` and the
 * peers that are not optional. An optional peer is not one: npm 12.2.1 leaves a package that only optional peers reach
 * extraneous, and prunes it (arborist's calc-dep-flags.js), so a fix never adds one for it (audit 6541743253, item 1).
 */
export function requiredNames(item: Record<string, any>): string[] {
  return [...new Set([...requirementList(item.dependencies, item.optionalDependencies), ...requiredPeers(item)].map(([name]) => name))];
}

/** Requirement groups as one list of [name, spec], sorted by name. A Map, not an object: a "__proto__" key stays a key. */
function requirementList(...groups: unknown[]): [string, string][] {
  return [...new Map(groups.flatMap(group => isPlain(group) ? Object.entries(group).map(([n, s]) => [n, typeof s === "string" ? s : `<${JSON.stringify(s)}>`] as [string, string]) : [])).entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}
const field = (value: unknown) => typeof value === "string" ? value : value === undefined ? "" : `<${JSON.stringify(value)}>`;

/**
 * `packages` as a view: every install path. A tree entry's `requires` is the entry's `dependencies` and
 * `optionalDependencies` (a link's: its folder's, `devDependencies` included, as npm writes it); npm 7 and later also
 * install an entry's peers, so the requirements it must find include its `peerDependencies` that `peerDependenciesMeta`
 * does not mark optional, and an optional one wherever the lookup finds a copy (`optional`). npm writes no flags on a link.
 */
function viewOfPackages(packages: Record<string, any>): Map<string, ViewEntry> {
  const view = new Map<string, ViewEntry>();
  for (const [path, item] of Object.entries(packages)) {
    if (lockKey(path, item) !== "install") continue;
    if (!isPlain(item)) throw new Error(`Unexpected package-lock entry at ${path}.`);
    const folder = item.link && typeof item.resolved === "string" && Object.hasOwn(packages, item.resolved) && isPlain(packages[item.resolved]) ? packages[item.resolved] : undefined;
    const alias = typeof item.name === "string" && item.name !== requireName(path);
    const version = item.link ? `file:${field(item.resolved)}` : alias ? `npm:${item.name}@${field(item.version)}` : field(item.version);
    const flags = item.link ? "" : TREE_FLAGS.filter(flag => (flag === "bundled" ? item.inBundle : item[flag]) === true).join(",");
    const requires = item.link ? requirementList(folder?.dependencies, folder?.optionalDependencies, folder?.devDependencies) : requirementList(item.dependencies, item.optionalDependencies);
    const peers = item.link ? [] : requiredPeers(item), optional = item.link ? [] : optionalPeers(item, requires);
    view.set(path, {
      // The requirements by name: a v2 lock's npm 6 tree writes the spec an override gives (`requires`), `packages` the
      // package's own; whether each copy is what its spec asks is requirementsMet's question, per view.
      path, key: [version, item.link ? "" : field(item.resolved), item.link ? "" : field(item.integrity), flags, JSON.stringify(requires.map(([name]) => name))].join("\0"),
      name: item.link ? (typeof folder?.name === "string" ? folder.name : requireName(path)) : alias ? item.name : requireName(path),
      version: item.link ? field(folder?.version) : field(item.version), link: item.link === true,
      dir: item.link ? `${field(item.resolved)}/` : `${path}/`, needs: [...requires, ...peers, ...optional],
      peers: new Set([...peers, ...optional].map(([name]) => name)), optional: new Set(optional.map(([name]) => name)),
    });
  }
  return view;
}

/**
 * The project and its folders (workspaces, local packages), which require from `packages` too: devDependencies
 * included, and the peers npm 7 and later install for them (review 6529858505, N4).
 */
function projects(packages: Record<string, any>): ViewEntry[] {
  return Object.entries(packages).filter(([path, item]) => isPlain(item) && (lockKey(path, item) === "root" || lockKey(path, item) === "folder")).map(([path, item]) => {
    const peers = requiredPeers(item), requires = requirementList(item.dependencies, item.optionalDependencies, item.devDependencies), optional = optionalPeers(item, requires);
    return { path, key: "", name: "", version: "", link: false, dir: path ? `${path}/` : "", needs: [...requires, ...peers, ...optional], peers: new Set([...peers, ...optional].map(([name]) => name)), optional: new Set(optional.map(([name]) => name)) };
  });
}

/**
 * The npm 6 tree as a view. Its entry `b` inside `a` is node_modules/a/node_modules/b; inside a link (version
 * "file:<folder>"), its children are in <folder>/node_modules. An alias is "npm:<name>@<version>". Only the keys of
 * TREE_KEYS, flags that are `true`, and `requires` that are specs are read; anything else throws.
 */
function viewOfTree(packages: Record<string, any>, tree: unknown): Map<string, ViewEntry> {
  const view = new Map<string, ViewEntry>();
  if (tree === undefined) return view;
  const walk = (level: unknown, prefix: string) => {
    if (!isPlain(level)) throw new Error(`package-lock.json's dependencies tree is not an object under ${prefix || "the root"}.`);
    for (const [name, entry] of Object.entries(level)) {
      const path = `${prefix}node_modules/${name}`;
      if (!isPlain(entry)) throw new Error(`Unexpected package-lock dependencies entry at ${path}.`);
      if (view.has(path)) throw new Error(`package-lock.json's dependencies tree has ${path} twice.`);
      const unknown = Object.keys(entry).filter(key => !TREE_KEYS.has(key));
      if (unknown.length) throw new Error(`package-lock.json's dependencies tree gives ${path} a key npm does not write: ${unknown.slice(0, 3).join(", ")}.`);
      const odd = TREE_FLAGS.filter(flag => entry[flag] !== undefined && entry[flag] !== true);
      if (odd.length) throw new Error(`package-lock.json's dependencies tree gives ${path} a flag that is not true: ${odd.join(", ")}.`);
      if (entry.requires !== undefined && (!isPlain(entry.requires) || Object.values(entry.requires).some(spec => typeof spec !== "string"))) throw new Error(`package-lock.json's dependencies tree gives ${path} requires that are not a list of specs.`);
      const linked = Object.hasOwn(packages, path) && isPlain(packages[path]) && packages[path].link === true ? packages[path] : undefined;
      const folder = linked && typeof linked.resolved === "string" && Object.hasOwn(packages, linked.resolved) && isPlain(packages[linked.resolved]) ? packages[linked.resolved] : undefined;
      const alias = /^npm:((?:@[^/@]+\/)?[^/@]+)@(.+)$/.exec(field(entry.version));
      const requires = requirementList(entry.requires);
      const dir = linked && typeof linked.resolved === "string" ? `${linked.resolved}/` : `${path}/`;
      view.set(path, {
        path, key: [field(entry.version), field(entry.resolved), field(entry.integrity), TREE_FLAGS.filter(flag => entry[flag] === true).join(","), JSON.stringify(requires.map(([name]) => name))].join("\0"),
        name: linked ? (typeof folder?.name === "string" ? folder.name : name) : alias ? alias[1]! : name,
        version: linked ? field(folder?.version) : alias ? alias[2]! : field(entry.version), link: !!linked, dir, needs: requires,
      });
      if (entry.dependencies !== undefined) walk(entry.dependencies, dir);
    }
  };
  walk(tree, "");
  return view;
}

/**
 * The specs the project's `overrides` give for `name` as `consumer` requires it with `spec`: a top-level key for the
 * name, and the same key nested under a package the consumer is or is installed under (the install paths its own path
 * runs through). A key is `name` or `name@selector`. As npm applies it, a selector must intersect the requirement's own
 * spec for the key to apply to it, and, for a key one descends through, the package installed there must be at a
 * version the selector takes; a selector that cannot be read as a semver range applies to nothing (an automated
 * security pass at 549fe1e). A value is a spec, `{ ".": spec }`, or `"$name"` (the project's own spec for that name).
 */
function overrideSpecs(overrides: unknown, project: Record<string, any>, view: Map<string, ViewEntry>, consumerPath: string, name: string, spec: string): string[] {
  if (!isPlain(overrides)) return [];
  const parse = (key: string) => { const at = key.indexOf("@", key.startsWith("@") ? 1 : 0); return at < 0 ? { name: key, selector: null } : { name: key.slice(0, at), selector: key.slice(at + 1) }; };
  const takes = (selector: string | null, test: (range: string) => boolean) => { if (selector === null || selector === "" || selector === "*") return true; try { return semver.validRange(selector, { loose: true }) !== null && test(selector); } catch { return false; } };
  const specOf = (value: unknown) => {
    const given = typeof value === "string" ? value : isPlain(value) && typeof value["."] === "string" ? value["."] : undefined;
    if (given === undefined || !given.startsWith("$")) return given;
    const own = [project.dependencies, project.devDependencies, project.optionalDependencies, project.peerDependencies].find(group => isPlain(group) && typeof group[given.slice(1)] === "string");
    return own ? own[given.slice(1)] as string : undefined;
  };
  // The packages the consumer is or is installed under: each install path its own path runs through, as `packages` has it.
  const segments = consumerPath.split("node_modules/");
  const ancestors = segments.slice(1).map((_, i) => view.get(segments.slice(0, i + 2).join("node_modules/").replace(/\/$/, ""))).filter((e): e is ViewEntry => !!e);
  const out: string[] = [];
  const walk = (level: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(level)) {
      if (key === ".") continue;
      const rule = parse(key);
      if (rule.name === name && takes(rule.selector, range => semver.validRange(spec, { loose: true }) !== null && semver.intersects(spec, range, { loose: true }))) {
        const given = specOf(value);
        if (given !== undefined) out.push(given);
      }
      if (isPlain(value) && ancestors.some(a => a.name === rule.name && takes(rule.selector, range => semver.satisfies(a.version, range, { loose: true })))) walk(value);
    }
  };
  walk(overrides);
  return out;
}

/**
 * Every requirement of every entry of a view, and of `consumers`, that the view leaves unmet, keyed (see
 * newUnmetRequirements). A requirement is met when Node's lookup (resolveFrom) finds a copy its spec takes: the package
 * it names (an "npm:" alias names another) at a version its semver range takes, or a link for a "file:" spec. In
 * `packages`, where the project's `overrides` apply to the requirement, the copy is checked against their spec instead
 * of the requirement's own, as npm does. A spec npm would resolve some other way (a tag, a URL, a git
 * spec) cannot be shown to be met (semver.satisfies is false for a range it cannot read). A peer is keyed without its
 * spec, so a peer the base already leaves out stays the same one when its requirer moves.
 */
function requirementsMet(view: Map<string, ViewEntry>, consumers: ViewEntry[], label: string, overrides: unknown, project: Record<string, any>): Map<string, string> {
  const unmet = new Map<string, string>();
  const takes = (found: ViewEntry, name: string, spec: string) => {
    if (spec.startsWith("file:")) return found.link;
    const alias = /^npm:((?:@[^/@]+\/)?[^/@]+)@(.+)$/.exec(spec);
    const [wanted, range] = alias ? [alias[1]!, alias[2]!] : [name, spec];
    return found.name === wanted && semver.satisfies(found.version, range, { loose: true });
  };
  for (const consumer of [...view.values(), ...consumers]) for (const [name, spec] of consumer.needs) {
    const found = resolveFrom(view, consumer.dir, name);
    // An optional peer that the lookup finds nothing for is met; one it finds is checked as any requirement.
    if (!found && consumer.optional?.has(name)) continue;
    // Where an override applies, npm checks the copy against the override's spec only, not the requirement's own
    // (review 6533374683, B2).
    const overridden = overrideSpecs(overrides, project, view, consumer.path, name, spec);
    if (found && (overridden.length ? overridden.some(s => takes(found, name, s)) : takes(found, name, spec))) continue;
    const peer = consumer.peers?.has(name) === true;
    unmet.set([label, consumer.path, name, peer ? "<peer>" : spec, found ? `${found.path}@${found.name}@${found.version}` : "<none>"].join("\0"),
      `package-lock.json's ${label}: ${consumer.path || "the project"} requires ${name} ${spec}, and ${found ? `${found.path} has ${found.name}@${found.version}, which is not that` : "npm finds no copy of it in the lock"}.`);
  }
  return unmet;
}

/** A package-lock `packages` key: an optional workspace prefix, then one or more node_modules/<name> segments. */
const LOCK_PATH = /^(?:[A-Za-z0-9@._-]+(?:\/[A-Za-z0-9@._-]+)*\/)?(?:node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+\/)*node_modules\/(?:@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9._-]+$/i;
/** The name a package is required by at a path: the last node_modules segment. */
export const requireName = (path: string) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
/**
 * An installed package's own workspace folder, which npm records as `extraneous` at a path that is not an install path
 * (node_modules/primitives/packages/ai-gateway). npm does not install it and Node never loads a package from there, so
 * it is skipped; it carries no tarball, hash or link. Any other key that is not an install path is still refused.
 */
const extraneousFolder = (path: string, item: any) => path.includes("node_modules/") && !LOCK_PATH.test(path) && item?.extraneous === true
  && item.resolved === undefined && item.integrity === undefined && item.link === undefined && !path.split("/").some(segment => segment === "." || segment === "..");

/**
 * What a package-lock `packages` key is: the project's root (""), an install path (LOCK_PATH), a folder of the project
 * (no node_modules segment: a workspace, or a local package), or an installed package's extraneous folder, which is
 * skipped (extraneousFolder). Any other key throws: a key in no known form is refused, never skipped. The judge
 * (lockEntries) and the PR job (deliver.ts) read keys through this one function (review 6518582507, B1).
 */
export function lockKey(path: string, item: unknown): "root" | "install" | "folder" | "extraneous" {
  if (path === "") return "root";
  if (path.includes("\\")) throw new Error(`Unexpected package-lock path: ${path}.`);
  if (!path.includes("node_modules/")) return "folder";
  if (extraneousFolder(path, item)) return "extraneous";
  // A key that is not a plain install path (.., backslashes, empty segments) could make two keys mean one place.
  if (!LOCK_PATH.test(path) || path.split("/").some(segment => segment === "." || segment === "..")) throw new Error(`Unexpected package-lock path: ${path}.`);
  return "install";
}

/** The skipped extraneous folders (see extraneousFolder), each with its entry, so a change to them can be stopped. */
export function lockExtraneous(lockText: string): string[] {
  return Object.entries(readLock(lockText)).filter(([path, item]) => !path.includes("\\") && extraneousFolder(path, item)).map(([path, item]) => `${path} ${JSON.stringify(item)}`).sort();
}

/** Installed registry packages in a package-lock v2/v3, by node_modules path. Links and the root are left out (see lockLinks). */
export function lockEntries(lockText: string): LockEntry[] {
  const entries: LockEntry[] = [];
  const folded = new Set<string>();
  for (const [path, item] of Object.entries(readLock(lockText))) {
    // On Windows and macOS, node_modules/Lodash and node_modules/lodash are one folder.
    if (folded.has(path.toLowerCase())) throw new Error(`Two package-lock paths differ only in case: ${path}.`);
    folded.add(path.toLowerCase());
    if (lockKey(path, item) !== "install" || item?.link) continue;
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

/** The flags npm writes from how an entry is reached, which decide what a production install leaves out. */
const LOCK_FLAGS = ["dev", "optional", "devOptional", "peer"];
/**
 * Every install path both locks have with the same package, version, `resolved` and `integrity`, whose flags alone
 * differ: lockEntryChanges leaves them out, and gate 2 checks them (docs/decisions/2026-10-31-flag-only-entries-gate2.md).
 */
export function lockFlagChanges(beforeText: string, afterText: string): LockEntry[] {
  const [before, after] = [readLock(beforeText), readLock(afterText)], atPath = new Map(lockEntries(beforeText).map(e => [e.path, e]));
  const flags = (item: Record<string, unknown>) => LOCK_FLAGS.filter(flag => item[flag] === true).join(",");
  return lockEntries(afterText).filter(e => {
    const b = atPath.get(e.path);
    return !!b && b.name === e.name && b.version === e.version && b.resolved === e.resolved && b.integrity === e.integrity && flags(before[e.path]) !== flags(after[e.path]);
  });
}

/** What Node would load for `name` required from the package at `dir` ("" for the project root): the nearest node_modules. */
export function resolveFrom<T>(entries: Map<string, T>, dir: string, name: string): T | undefined {
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

/** Packages the project itself declares: the root's and the workspace folders' dependencies of every kind. */
export function declaredByProject(lockText: string): string[] {
  return [...new Set(consumers(lockText).filter(c => c.path === "" || !c.path.includes("node_modules/")).flatMap(c => c.requires))].sort();
}

/** Something that requires packages: the project root, a workspace folder, or an installed package. */
type Consumer = { path: string; name: string; dir: string; requires: string[] };
/** The requirements an installed package's lock entry declares (devDependencies are not installed for it). */
export const DECLARED = ["dependencies", "optionalDependencies", "peerDependencies"];

function consumers(lockText: string): Consumer[] {
  const out: Consumer[] = [];
  for (const [path, item] of Object.entries(readLock(lockText))) {
    if (!item || typeof item !== "object" || item.link || extraneousFolder(path, item)) continue;
    const own = path === "" || !path.includes("node_modules/");
    // The root and workspace folders also require their devDependencies; installed packages do not.
    const groups = own ? [...DECLARED, "devDependencies"] : DECLARED;
    const requires = [...new Set(groups.flatMap(group => item[group] && typeof item[group] === "object" ? Object.keys(item[group]) : []))].sort();
    const name = own ? `<${path || "root"}>` : typeof item.name === "string" ? item.name : requireName(path);
    out.push({ path, name, dir: path ? `${path}/` : "", requires });
  }
  return out;
}

/**
 * What every dependent loads, before and after. A dependent at a path that held the same package before is compared
 * with what that copy loaded. One at a new path (moved, or a new copy) is unchanged only if every earlier copy of that
 * package, whatever its version, loaded the same target; otherwise it is compared with each earlier target that differs
 * (the same name as an earlier version, another name as a replacement). A target it did not load before is a change, however the tree moved to get there: a shadowing
 * copy, a moved or upgraded dependent, a removed copy, an alias. A requirement nothing satisfied before (a new
 * dependency) is not compared here; a newly installed target is judged by the lockfile diff.
 */
export function resolutionChanges(beforeText: string, afterText: string): Change[] {
  const resolve = (text: string) => {
    const entries = new Map(lockEntries(text).map(e => [e.path, e]));
    const byPath = new Map<string, LockEntry>(), byName = new Map<string, LockEntry[]>(), names = new Map<string, string>();
    for (const c of consumers(text)) {
      names.set(c.path, c.name);
      for (const name of c.requires) {
        const target = resolveFrom(entries, c.dir, name);
        if (!target) continue;
        byPath.set(`${c.path}\0${name}`, target);
        byName.set(`${c.name}\0${name}`, [...(byName.get(`${c.name}\0${name}`) ?? []), target]);
      }
    }
    return { byPath, byName, names, consumers: consumers(text) };
  };
  const before = resolve(beforeText), after = resolve(afterText);
  const changes = new Map<string, Change>();
  for (const c of after.consumers) for (const name of c.requires) {
    const target = after.byPath.get(`${c.path}\0${name}`);
    if (!target) continue;
    const samePlace = before.names.get(c.path) === c.name;
    const was = samePlace ? [before.byPath.get(`${c.path}\0${name}`)].filter((t): t is LockEntry => !!t) : before.byName.get(`${c.name}\0${name}`) ?? [];
    if (!was.length) continue;
    const same = (w: LockEntry) => w.name === target.name && w.version === target.version && w.integrity === target.integrity;
    if (samePlace ? same(was[0]!) : was.every(same)) continue;
    for (const w of was) {
      if (same(w)) continue;
      const from = w.name === target.name ? w.version : null;
      const replaced = w.name === target.name ? null : `${w.name}@${w.version}`;
      const id = `${target.name}\0${from}\0${target.version}\0${replaced}\0${target.integrity}`;
      const existing = changes.get(id);
      changes.set(id, existing ? { ...existing, dev: existing.dev && target.dev } : { path: target.path, name: target.name, from, to: target.version, dev: target.dev, resolved: target.resolved, integrity: target.integrity, replaced });
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
/** A key's own value: a key the object does not have is missing, not Object.prototype (JSON.parse makes "__proto__" an own key). */
export const own = (owner: object, key: string): unknown => Object.hasOwn(owner, key) ? (owner as Record<string, unknown>)[key] : undefined;
/**
 * Why a package.json change is more than a dependency update: any other field (scripts run on install, for one), or a
 * dependency or override that leaves the registry.
 */
export function manifestChanges(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  if (typeof after !== "object" || after === null || Array.isArray(after)) return ["package.json is not an object."];
  const out: string[] = [];
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (JSON.stringify(own(b, key)) === JSON.stringify(own(a, key))) continue;
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
    for (const [name, spec] of Object.entries(group)) if (spec !== own(old, name) && !registrySpec(spec)) out.push(`package.json ${key}.${name} is "${String(spec)}", not a registry range.`);
  }
  return out;
}

/** Urgency of the change: from the advisories it fixes, and whether any fixed package is used in production. */
export function urgencyOf(fixes: FixedAdvisory[], changes: Change[], epssHigh = 0.1): Urgency {
  // Every fix counts here, not only the change's own (ownFixes): a dependent that moves off the vulnerable version in
  // production ends a production exposure. Matching `from` keeps out copies that were never vulnerable.
  const fixes_ = (c: Change, f: FixedAdvisory) => c.name === f.package && c.from === f.from && c.to === f.to;
  const fixed = fixes.filter(f => changes.some(c => fixes_(c, f)));
  // A fix's urgency counts only for the versions it fixes: a dev-only fix does not hurry a production passenger.
  const fixing = changes.filter(c => fixed.some(f => fixes_(c, f)) && !c.dev);
  if (!changes.some(c => !c.dev)) return "low";
  if (!fixing.length) return "normal";
  const urgent = fixed.filter(f => fixing.some(c => fixes_(c, f)));
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
  /** Every entry whose flags alone changed (lockFlagChanges): gate 2's checks of its version, nothing else. */
  flagged?: LockEntry[];
  now: Date;
  /** A stricter project wait, in hours, per urgency (design: the stricter setting wins). */
  projectWait?: Partial<Record<Urgency, number>>;
  /** Lookup failures: each makes the judgement undecidable. */
  errors?: string[];
  /** package.json before and after, when it changed: only registry dependency specs may change. */
  manifest?: { before: unknown; after: unknown };
  /** `name@version` of everything in the lockfile before the change; by default the replaced versions. */
  locked?: Set<string>;
  /** Packages the project declares directly: the time cap's targets when the change fixes no advisory. */
  direct?: string[];
  /** First publish per package name, for new dependencies (rule 2). A missing name is undecidable. */
  created?: Map<string, string | null>;
  /** pnpm-lock.yaml changes are read as name@version sets: gate 4's per-entry checks are not implemented for them. */
  lockfile?: "package-lock" | "pnpm-lock";
  /** Skipped extraneous lockfile folders (lockExtraneous) that are added, removed or changed. */
  extraneous?: string[];
  /**
   * Changed workspace package.json files (workspace-manifests.ts) with why each is more than the lockfile's dependency
   * update: no reasons when it agrees, null when a side could not be read.
   */
  workspaces?: { file: string; reasons: string[] | null }[];
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
  const lockName = input.lockfile === "pnpm-lock" ? "pnpm-lock.yaml" : "package-lock.json";
  if (input.files === null || !input.files.includes(lockName)) {
    add({ gate: 4, effect: "info", message: input.files === null ? `The PR's changed files were not given (--files), so gate 4 could not check that only package.json and ${lockName} change.` : `The given changed files do not include ${lockName}, although the lockfile changed.` });
    undecidable = true;
  } else {
    // A workspace's package.json may change too, but only as the lockfile records it
    // (docs/decisions/2026-10-29-l9-workspace-package-json.md).
    const agreeing = (input.workspaces ?? []).filter(w => w.reasons?.length === 0 && input.files!.includes(w.file)).map(w => w.file);
    const unexpected = input.files.filter(f => !["package.json", lockName].includes(f) && !agreeing.includes(f));
    if (unexpected.length) add({ gate: 4, effect: "stop", message: `The change also touches ${unexpected.join(", ")}; a dependency update must change only package.json and ${lockName}.` });
    for (const { file, reasons } of input.workspaces ?? []) {
      if (!input.files.includes(file)) continue;
      if (reasons === null) { add({ gate: 4, effect: "stop", message: `${file} could not be read both before and after the change, so whether it agrees with the lockfile is undecidable.` }); undecidable = true; }
      else for (const message of reasons) add({ gate: 4, effect: "stop", message });
    }
    if (agreeing.length) add({ gate: 4, effect: "info", message: `${agreeing.join(", ")}: a workspace's dependency lists change, and before and after they equal the lockfile's record of that workspace.` });
  }
  if (input.lockfile === "pnpm-lock") { add({ gate: 4, effect: "info", message: "pnpm-lock.yaml is read as the set of versions it adds: each entry's tarball and hash, and what each dependent loads, are not checked for pnpm." }); undecidable = true; }
  if (input.manifest) for (const message of manifestChanges(input.manifest.before, input.manifest.after)) add({ gate: 4, effect: "stop", message });
  for (const link of input.links ?? []) add({ gate: 4, effect: "stop", message: `${link}: a link to a local directory that is new or points elsewhere, instead of a registry package.` });
  for (const entry of input.extraneous ?? []) add({ gate: 4, effect: "stop", message: `An extraneous lockfile folder outside the install paths is added, removed or changed: ${entry.slice(0, 300)}` });
  const entries: LockEntry[] = input.lockfile === "pnpm-lock" ? [] : input.entries ?? changes.map(c => ({ path: c.path, name: c.name, version: c.to, dev: c.dev, resolved: c.resolved, integrity: c.integrity }));
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
    const event = next.provenance && eventProblem(next.provenance);
    if (event) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to}'s provenance ${event}.` });
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
    // The repository's immutable id as well (docs/decisions/2026-10-30-provenance-immutable-id.md): a name can be registered again.
    if (prev.provenance && next.provenance) {
      const ids = repositoryIds(prev.provenance, next.provenance);
      if (ids === "differ") add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} was built from GitHub repository id ${next.provenance.repository_id}, not ${prev.provenance.repository_id} like ${c.from}.` });
      else if (ids === "one") add({ gate: 2, package: c.name, effect: "stop", message: `Only one of ${c.name}@${c.from} and ${c.to} records a GitHub repository id in its provenance, so they cannot be compared.` });
      else if (ids === "none") add({ gate: 2, package: c.name, effect: "info", message: `Neither ${c.name}@${c.from} nor ${c.to} records a GitHub repository id in its provenance: compared by repository name and workflow, not by ID.` });
    }
    // Comparable only when both sides name a repository and a workflow.
    if (!prev.provenance?.repository || !prev.provenance.workflow || !next.provenance?.repository || !next.provenance.workflow) comparable = false;
    const added = next.install_scripts.filter(s => !prev.install_scripts.includes(s));
    if (added.length) add({ gate: 2, package: c.name, effect: "stop", message: `${c.name}@${c.to} adds install scripts: ${added.join(", ")}.` });
    if (prev.publisher !== next.publisher) { add({ gate: 2, package: c.name, effect: "extend", message: `${c.name}@${c.to} was published by ${next.publisher ?? "unknown"}, ${c.from} by ${prev.publisher ?? "unknown"}.` }); extended = true; }
    const newDeps = next.dependencies.filter(d => !prev.dependencies.includes(d));
    if (newDeps.length) { add({ gate: 2, package: c.name, effect: "extend", message: `${c.name}@${c.to} adds dependencies: ${newDeps.join(", ")}.` }); extended = true; }
  }

  // Gate 2 on every entry whose flags alone changed ("Check every package in the lockfile diff";
  // docs/decisions/2026-10-31-flag-only-entries-gate2.md): its own version's MAL- records, withdrawal and deprecation.
  // It is its own predecessor, so nothing is compared, it sets no wait and the time cap does not count it.
  for (const e of input.flagged ?? []) {
    const fact = facts.get(`${e.name}@${e.version}`), what = `${e.name}@${e.version} at ${e.path} (its flags alone changed)`;
    if (!fact) { add({ gate: 2, package: e.name, effect: "stop", message: `No registry facts for ${what}; undecidable.` }); undecidable = true; continue; }
    if (fact.malicious.length) add({ gate: 2, package: e.name, effect: "stop", message: `${what} is in OSV's malicious-package records (${fact.malicious.join(", ")}).` });
    if (!fact.present) add({ gate: 2, package: e.name, effect: "stop", message: `${what} is no longer listed by the registry (unpublished or withdrawn).` });
    if (fact.deprecated) add({ gate: 2, package: e.name, effect: "stop", message: `${what} is deprecated: ${fact.deprecated.slice(0, 200)}` });
    if (fact.advisories.length) add({ gate: 1, package: e.name, effect: "info", message: `${what} has known advisories, as before: ${fact.advisories.join(", ")}.` });
  }

  // Rules 1 and 2: T is the fix's publish time (the changed direct dependencies' when nothing is fixed). A version
  // published at or after T that is the same release as a target is allowed; the wait above already counts from it.
  const locked = input.locked ?? new Set(changes.flatMap(c => c.from ? [`${c.name}@${c.from}`] : []));
  const lockedNames = new Set([...locked].map(id => id.slice(0, id.lastIndexOf("@"))));
  // The targets are the change's own fixing versions (ownFixes): another copy of a fixed package, added or newly loaded
  // in the same change, neither sets T nor anchors a sibling (as in `ludion patch`).
  let targets = changes.filter(fixedBy(fixes));
  if (!targets.length) targets = changes.filter(c => (input.direct ?? []).includes(c.name));
  const newDependencies = changes.flatMap(c => {
    const next = facts.get(`${c.name}@${c.to}`), prev = c.from ? facts.get(`${c.name}@${c.from}`) : undefined;
    return [...(next && prev?.present ? next.dependencies.filter(d => !prev.dependencies.includes(d)) : []), ...(lockedNames.has(c.name) ? [] : [c.name])];
  });
  const created = new Map(input.created ?? []);
  for (const [id, f] of facts) if (f.package_created !== undefined && !created.has(id.slice(0, id.lastIndexOf("@")))) created.set(id.slice(0, id.lastIndexOf("@")), f.package_created);
  const cap = timeCap({
    targets: targets.map(c => ({ name: c.name, version: c.to })), others: changes.map(c => ({ name: c.name, version: c.to })), locked, newDependencies,
    published: (name, version) => facts.get(`${name}@${version}`)?.published_at,
    created: name => created.get(name),
    identity: (name, version) => { const f = facts.get(`${name}@${version}`); return f && releaseIdentity(f); },
    waitHours: WAIT_HOURS[urgency],
  });
  if (changes.length) {
    for (const reason of cap.undecidable) { add({ gate: 2, effect: "stop", message: `Time cap: ${reason}` }); undecidable = true; }
    for (const id of cap.after_t) add({ gate: 2, package: id.slice(0, id.lastIndexOf("@")), effect: "stop", message: `${id} was published at or after the fix (T = ${cap.t}); only versions already locked or published before T may move with it.` });
    for (const young of cap.young) add({ gate: 2, effect: "stop", message: `New dependency ${young}: the package first appeared less than ${cap.wait_hours}h before the fix (T = ${cap.t}).` });
  }

  let wait = WAIT_HOURS[urgency];
  if (urgency === "exploited" && !comparable) wait = EXPLOITED_UNCOMPARABLE_HOURS;
  if (extended) wait = Math.max(wait * 2, EXTENDED_MIN_HOURS);
  const stricter = input.projectWait?.[urgency];
  if (stricter !== undefined && stricter > wait) wait = stricter;
  const waitUntil = newest ? new Date(Date.parse(newest) + wait * 3_600_000).toISOString() : null;

  const stopped = findings.some(f => f.effect === "stop");
  const verdict: Judgement["verdict"] = undecidable ? "undecidable" : stopped ? "stop" : waitUntil && now.getTime() < Date.parse(waitUntil) ? "wait" : "ready_except_build";
  const fixing = changes.filter(fixedBy(fixes)).map(c => facts.get(`${c.name}@${c.to}`)?.published_at).filter((t): t is string => !!t).sort();
  return {
    schema: 1, judged_at: now.toISOString(), verdict, urgency, wait_hours: wait, newest_publish: newest, wait_until: waitUntil,
    changes, fixes, findings,
    exposure: { fix_published_at: fixing.at(-1) ?? null, detected_at: now.toISOString() },
    time_cap: cap,
    not_checked: [
      "Gate 3 (build and tests of old and new versions) is not run by the judge v0.",
      "Obfuscated code and new network or process calls in the changed code are not inspected.",
      "Gate 1's OS, SAPI and configuration conditions are not matched, and production and dev-only dependencies are not told apart: every changed version counts as production.",
      "Provenance is read from the registry's attestation record and must name the version and its tarball hash; its Sigstore signature and certificate are not verified here, so provenance (its repository, workflow and commit, and the same-release exception that relies on it) rests on the registry's checks at publish time.",
      "The GitHub repository id and event in a provenance statement are written by npm from the build's environment variables, which the publishing workflow can set; Ludion has not established that the registry matches them against the signing certificate. A re-registered repository name whose publisher writes the old id and an allowed event passes these checks and is caught only by the wait and the re-query.",
      "A hijacked publisher account with no provenance change is caught only by the wait and the re-query when it ends; the re-query happens only when the judge is run again after the wait (nothing schedules it yet).",
      "A v2 lockfile's npm 6 `dependencies` tree is read to check that it says the same as `packages`, and both are read to check that the change leaves no requirement unmet that the base met (the project's `overrides` count in `packages`). This reading has been checked against locks npm 7.10.0, 8.19.4, 9.8.1, 10.8.2, 11.19.1 and 12.2.1 wrote (with nested copies, aliases, workspaces, local folders, `overrides`, `--legacy-peer-deps` and bundled entries) and against npm 12.2.1's own report on them and on one-change variants, not against other npm versions' locks.",
      "A dependency newly required by a package (nothing satisfied it before) is not compared when it lands on a copy that was already installed; that copy's own advisories are not reported for it.",
    ],
  };
}

/** The judgement as a PR comment. Plain text; every reason is shown. */
export function renderJudgement(j: Judgement): string {
  const head = { stop: "Ludion judgement: STOP — not applied automatically", wait: `Ludion judgement: wait until ${j.wait_until}`, ready_except_build: "Ludion judgement: gates 1, 2 and 4 found nothing and the wait is over — build/test gate not run (v0)", undecidable: "Ludion judgement: undecidable — not applied automatically" }[j.verdict];
  const lines = [head, `Urgency: ${j.urgency} · wait ${j.wait_hours}h from the newest publish (${j.newest_publish ?? "unknown"})`, ...renderTimeCap(j.time_cap)];
  lines.push(`Changed packages (${j.changes.length}):`);
  for (const c of j.changes) lines.push(`  ${c.name} ${c.from ?? "(new)"} → ${c.to}${c.dev ? " (dev)" : ""}${c.replaced ? ` (replaces ${c.replaced} at ${c.path})` : ""}`);
  if (j.fixes.length) lines.push(`Fixes: ${[...new Set(j.fixes.map(f => f.id))].join(", ")}`);
  const epssDates = [...new Set(j.fixes.filter(f => f.epss_date !== undefined).map(f => f.epss_date ?? "not given"))];
  if (epssDates.length) lines.push(`EPSS list (FIRST) score date: ${epssDates.join(", ")}`);
  const order = { stop: 0, extend: 1, info: 2 } as const;
  for (const f of [...j.findings].sort((a, b) => order[a.effect] - order[b.effect])) lines.push(`  [${f.effect}] gate ${f.gate}: ${f.message}`);
  if (!j.findings.length) lines.push("  No gate finding.");
  lines.push("Not checked:");
  for (const n of j.not_checked) lines.push(`  - ${n}`);
  lines.push(`Exposure: fix published ${j.exposure.fix_published_at ?? "n/a"} · seen ${j.exposure.detected_at}`);
  return lines.join("\n");
}
