import { randomUUID } from "node:crypto";
import { closeSync, cpSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import semver from "semver";
import { runContainer, runDockerImageCommand, type Tool } from "../../../sandbox/src/docker.ts";
import { changedManifest, DEFAULT_IMAGES, inventory, jsonFile, MANIFESTS, mavenGraph, packageEntry, parsePom, textFile, type Change, type Ecosystem, type Inventory } from "./inventory.ts";
import { comparableVersion, OsvClient, type DependencyScan } from "./osv.ts";
import { hash } from "./php.ts";
import { CONFIG, privateState, readConfig, rootPath, snapshot } from "./project.ts";
import { branchName, branchSubject, fixBranch, gitBase } from "./branch.ts";
import { dependencyFixPublished } from "./exposure.ts";
import { acquisitionPom, localComposerLock, MAVEN_SETTINGS, publicArchiveUrl, type ArchiveEvidence } from "./acquisition.ts";
import { releaseIdentity, WAIT_HOURS } from "./judge.ts";
import { registryFacts } from "./npm-facts.ts";
import { composerVersion, npmReleases, packagistReleases, renderTimeCap, timeCap, type ReleaseIdentity, type Releases, type TimeCap } from "./time-cap.ts";

/**
 * One run: one baseline, then each fix (every planned change of one package) validated on its own against it. `outcome`
 * is "partial" when some fixes failed, or some findings have no supported fix, and others did not; "skipped" when every fix
 * already had its branch, so nothing was validated.
 */
export type DependencyReceipt = {
  schema: 2; id: string; ecosystem: Ecosystem; scope: "dependency_files_only_not_deployed";
  started_at: string; finished_at: string; outcome: "failed" | "validated" | "applied" | "partial" | "skipped";
  tree_hash: string; config_hash: string; before: DependencyScan;
  tool_image: string; baseline_image: string | null; baseline_passed: boolean; test: string[];
  /** With --apply: the commit every fix branch starts from, checked to hold the validated files. */
  base_commit: string | null;
  /** The baseline's Composer archives. */
  archives?: ArchiveEvidence[];
  fixes: FixReceipt[];
  reason?: string;
};
/** One fix: its candidate is the baseline with only this package moved. A failed fix stops nothing else. */
export type FixReceipt = {
  package: string; changes: Change[];
  /** "skipped": with --apply, a branch for this fix already exists; it was not validated again or changed. */
  outcome: "failed" | "validated" | "applied" | "skipped";
  /** Exposure-time timestamps (UTC): the fix's official publication, the advisory lookup of this run, the branch. */
  fix_published_at: string | null; fix_published_note: string; found_at: string; applied_at: string | null;
  branch: string | null; commit: string | null;
  candidate_image: string | null; candidate_passed: boolean; after: DependencyScan | null;
  files: { path: string; before_hash: string; after_hash: string }[];
  archives?: ArchiveEvidence[];
  /** Every package whose installed versions differ between baseline and candidate, planned or not. */
  changed_packages?: PackageChange[];
  /** Rules 1 and 2 of the time cap on the candidate (npm and Composer). */
  time_cap?: TimeCap;
  /**
   * Findings of the candidate on another package at a version the baseline did not have, under an advisory the baseline
   * already had on that package (for example Maven moving it). Allowed, and listed here.
   */
  carried_findings?: string[];
  reason?: string;
};
export type PackageChange = { name: string; from: string[]; to: string[] };
/** The final manifest beside the pinned one in the npm candidate context (see resolverDockerfile). */
export const NPM_FINAL_MANIFEST = "ludion-final-package.json";
type Dependencies = { client?: OsvClient; fetchFn?: typeof fetch; signal?: AbortSignal; command?: typeof runDockerImageCommand; testRun?: (name: string, image: string, command: readonly string[], timeoutMs: number, tool: Tool) => Promise<void> };

/** Packages whose set of installed versions differs between two inventories, sorted by name. */
export function changedPackages(before: Inventory, after: Inventory): PackageChange[] {
  const versions = (inventory: Inventory) => {
    const map = new Map<string, string[]>();
    for (const p of inventory.packages) map.set(p.name, [...(map.get(p.name) ?? []), p.version].sort());
    return map;
  };
  const a = versions(before), b = versions(after);
  return [...new Set([...a.keys(), ...b.keys()])].sort()
    .map(name => ({ name, from: a.get(name) ?? [], to: b.get(name) ?? [] }))
    .filter(c => c.from.join("\0") !== c.to.join("\0"));
}

/**
 * Baseline package versions that the candidate no longer has although no planned fix replaces them. A smallest-fix
 * candidate may add packages (a fixed version's new dependencies) but must not move anything else.
 */
export function unplannedRemovals(before: Inventory, after: Inventory, plan: Change[]): string[] {
  const kept = new Set(after.packages.map(p => `${p.name}\0${p.version}`));
  const planned = new Set(plan.map(c => `${c.name}\0${c.from}`));
  return before.packages.filter(p => !kept.has(`${p.name}\0${p.version}`) && !planned.has(`${p.name}\0${p.version}`)).map(p => `${p.name}@${p.version}`);
}

/**
 * The time cap on a candidate (docs/decisions.md, "Moving dependencies are capped at the fix's publish time"). T is the
 * latest publish time of the planned packages' new versions. Every other version the candidate adds must have been
 * published before T, and a package new to the lockfile, or newly required by a planned package, must have first
 * appeared at least the wait before T. `ludion patch` computes no urgency, so the longest wait (168h) applies.
 * npm: a version published at or after T may move when it is the same release as a planned version (publisher and
 * provenance read from the registry). Composer: Packagist has neither, so nothing published at or after T may move.
 */
export async function candidateTimeCap(ecosystem: "npm" | "composer", before: Inventory, after: Inventory, plan: Change[], fetchFn: typeof fetch = fetch): Promise<TimeCap> {
  const locked = new Set(before.packages.map(p => `${p.name}@${p.version}`)), lockedNames = new Set(before.packages.map(p => p.name));
  const added = after.packages.filter(p => !locked.has(`${p.name}@${p.version}`));
  const planned = new Set(plan.map(c => c.name));
  const releases = new Map<string, Releases>();
  const read = async (name: string) => {
    if (!releases.has(name)) releases.set(name, await (ecosystem === "npm" ? npmReleases : packagistReleases)(name, fetchFn));
    return releases.get(name)!;
  };
  for (const name of new Set(added.map(p => p.name))) await read(name);
  const newDependencies = added.filter(p => !lockedNames.has(p.name)).map(p => p.name);
  for (const p of added.filter(p => planned.has(p.name))) {
    const r = await read(p.name), from = before.packages.filter(b => b.name === p.name).map(b => r.requires.get(composerVersion(b.version)));
    const now = r.requires.get(composerVersion(p.version)) ?? [];
    newDependencies.push(...now.filter(d => !from.some(f => f?.includes(d))));
  }
  for (const name of new Set(newDependencies)) await read(name);
  // The targets are the plan's own versions, so another copy of a planned package can neither set T nor anchor a sibling.
  const plannedTo = new Set(plan.map(c => `${c.name}@${composerVersion(c.to)}`));
  const input = {
    targets: added.filter(p => plannedTo.has(`${p.name}@${composerVersion(p.version)}`)), others: added, locked, newDependencies,
    published: (name: string, version: string) => releases.get(name)?.published.get(composerVersion(version)),
    created: (name: string) => releases.get(name)?.created,
    waitHours: WAIT_HOURS.low,
  };
  const cap = timeCap(input);
  if (ecosystem !== "npm" || !cap.after_t.length) return cap;
  // Publisher and provenance only for the planned versions and those published at or after T. A failed read keeps the
  // first cap (T and the count) and makes it undecidable.
  const identities = new Map<string, ReleaseIdentity>();
  const wanted = [...input.targets.map(p => `${p.name}@${p.version}`), ...cap.after_t];
  try {
    for (const name of new Set(wanted.map(id => id.slice(0, id.lastIndexOf("@"))))) {
      const versions = wanted.filter(id => id.slice(0, id.lastIndexOf("@")) === name).map(id => id.slice(id.lastIndexOf("@") + 1));
      for (const [version, f] of await registryFacts(name, versions, fetchFn)) identities.set(`${name}@${version}`, releaseIdentity({ ...f, malicious: [], advisories: [] }));
    }
  } catch (error) {
    return { ...cap, undecidable: [...cap.undecidable, `The publisher and provenance for the same-release check could not be read: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`] };
  }
  return timeCap({ ...input, identity: (name, version) => identities.get(`${name}@${version}`) });
}

export function compatible(before: Inventory, after: Inventory): void {
  for (const pkg of before.packages) {
    const next = after.packages.filter(p => p.name === pkg.name);
    const old = comparableVersion(pkg.version, pkg.ecosystem);
    const allowed = (p: typeof pkg) => { const current = comparableVersion(p.version, p.ecosystem); return !!old && !!current && semver.major(current) === semver.major(old) && (semver.major(old) !== 0 || semver.minor(current) === semver.minor(old)); };
    if (pkg.direct && !next.some(p => p.direct && allowed(p))) throw new Error(`Candidate removed or changed the major version of a direct dependency: ${pkg.name}.`);
    if (next.some(p => p.version === pkg.version)) continue;
    const novel = next.filter(p => !before.packages.some(b => b.name === p.name && b.version === p.version));
    if (novel.length && !novel.some(allowed)) {
      throw new Error(`Automatic update would change an existing package's major version: ${pkg.name}.`);
    }
    if (pkg.direct && !next.length) throw new Error(`Candidate removed a direct dependency: ${pkg.name}.`);
  }
}

/** Keep credentials/config/extensions out of online acquisition. Application source is copied only for offline tests. */
export function acquisitionPolicy(root: string, ecosystem: Ecosystem): void {
  if (ecosystem === "npm") {
    const p = jsonFile(root, "package.json"), lock = jsonFile(root, "package-lock.json");
    if (p.workspaces) throw new Error("Register npm workspaces individually after producing a standalone package-lock; workspace patching is not supported yet.");
    for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, spec] of Object.entries(p[group] ?? {})) if (typeof spec !== "string" || !semver.validRange(spec)) throw new Error(`Non-registry or unresolved npm requirement needs review: ${name}.`);
    }
    const overrides = (item: unknown): void => {
      if (typeof item === "string") { if (!semver.validRange(item)) throw new Error("Non-registry npm overrides need manual review."); }
      else if (item && typeof item === "object" && !Array.isArray(item)) for (const value of Object.values(item)) overrides(value);
      else throw new Error("Invalid npm overrides.");
    };
    if (p.overrides) overrides(p.overrides);
    for (const item of Object.values(lock.packages ?? {}) as any[]) {
      if (item.link) throw new Error("Linked npm packages need manual review.");
      if (item.resolved !== undefined) {
        const url = new URL(item.resolved);
        if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username || url.password) throw new Error("Automatic npm acquisition accepts only public registry.npmjs.org tarballs.");
      }
    }
  } else if (ecosystem === "composer") {
    const p = jsonFile(root, "composer.json");
    if (p.repositories) throw new Error("Custom Composer repositories need a separate trusted acquisition policy.");
    if (p.config?.["vendor-dir"] && p.config["vendor-dir"] !== "vendor") throw new Error("Custom Composer vendor directories are not supported yet.");
    for (const key of ["http-basic", "bearer", "github-oauth", "gitlab-oauth", "gitlab-token"]) if (p.config?.[key]) throw new Error("Credentials must not be embedded in the acquisition manifest.");
    if (p.config?.["secure-http"] === false || p.config?.["disable-tls"]) throw new Error("Insecure Composer transport is refused.");
    if (p.config?.["source-fallback"] || p.config?.policy !== undefined || p.config?.audit !== undefined) throw new Error("Composer policy overrides/source fallback need manual review.");
    const lock = jsonFile(root, "composer.lock");
    for (const item of [...(lock.packages ?? []), ...(lock["packages-dev"] ?? [])]) {
      if (item.dist?.url && item.dist.type === "zip") publicArchiveUrl(item.dist.url);
      else throw new Error("Composer acquisition requires a distribution archive for every locked package.");
    }
  } else {
    const p = parsePom(textFile(root, "pom.xml"));
    if (p.limitations.length) throw new Error(p.limitations.join(" "));
    const elements = Array.from(p.document.getElementsByTagName("*"));
    if (elements.some(e => ["extensions", "repositories", "pluginRepositories", "profiles", "modules", "parent"].includes(e.localName ?? ""))) throw new Error("Maven parents, profiles, extensions, modules and custom repositories need manual review.");
    if (elements.some(e => e.namespaceURI !== p.project.namespaceURI)) throw new Error("Mixed-namespace Maven models need review.");
    const packaging = elements.find(e => e.parentNode === p.project && e.localName === "packaging")?.textContent?.trim();
    if (packaging && packaging !== "jar" && packaging !== "pom") throw new Error("Custom Maven packaging needs review.");
  }
}

/**
 * The candidate moves only the planned packages (docs/design.md: the smallest fix, nothing else). npm: a lockfile-only
 * install from the pinned manifest records exactly the fixed versions, a second one from the final manifest keeps them,
 * then `npm ci` installs that lockfile. Composer: `update` of the planned packages at their fixed versions, with
 * --minimal-changes. Planned names and versions are inventory coordinates, never options.
 */
export function resolverDockerfile(ecosystem: Ecosystem, image: string, candidate: boolean, inventoryOnly = false, plan: Change[] = []): string {
  const run = (args: string[]) => `RUN ${JSON.stringify(args)}\n`;
  if (candidate && ecosystem !== "maven") {
    if (!plan.length) throw new Error("A candidate needs at least one planned fix.");
    for (const change of plan) {
      packageEntry(ecosystem, change.name, change.to, false);
      if (!/^\d/.test(change.to)) throw new Error("Planned fixed versions must start with a digit.");
    }
  }
  const npmFlags = ["--ignore-scripts", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org"];
  let text = `FROM ${image} AS resolve\nUSER root\nRUN mkdir -p /app /opt/ludion-m2 && chown -R 65534:65534 /app /opt/ludion-m2\nWORKDIR /app\nENV HOME=/tmp COMPOSER_HOME=/tmp/composer MAVEN_CONFIG=/tmp/maven NPM_CONFIG_CACHE=/tmp/npm\n`;
  if (ecosystem === "npm") {
    text += run(["npm", "install", "--global", "npm@12.2.1", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"]);
    text += run(["chown", "-R", "65534:65534", "/tmp/npm"]);
  }
  text += "COPY --chown=65534:65534 manifests/ ./\nUSER 65534:65534\n";
  if (ecosystem === "npm") {
    text += run(["node", "-e", "if(require('/usr/local/lib/node_modules/npm/package.json').version!=='12.2.1')process.exit(1)"]);
    if (candidate) {
      text += run(["npm", "install", "--package-lock-only", ...npmFlags]);
      text += run(["cp", NPM_FINAL_MANIFEST, "package.json"]);
      text += run(["npm", "install", "--package-lock-only", ...npmFlags]);
      text += run(["rm", NPM_FINAL_MANIFEST]);
    }
    text += run(["npm", "ci", ...npmFlags]);
  }
  else if (ecosystem === "composer" && candidate) text += run(["composer", "update", "--with-dependencies", "--minimal-changes", "--no-install", "--no-plugins", "--no-scripts", "--no-interaction", "--prefer-dist", "--no-progress", "--", ...plan.map(c => `${c.name}:${c.to}`)]);
  else {
    const goal = "org.apache.maven.plugins:maven-dependency-plugin:3.11.0:";
    if (ecosystem === "maven") {
      text += run(["mvn", "--batch-mode", "--settings", "/app/ludion-settings.xml", "-Dmaven.repo.local=/opt/ludion-m2", ...(inventoryOnly ? [] : [`${goal}go-offline`, `${goal}copy-dependencies`, "-DoutputDirectory=/app/lib"]), `${goal}tree`, "-DoutputType=json", "-DoutputFile=/app/ludion-dependency-tree.json", "-Dmdep.skip=false"]);
      text += run(["cp", "/app/ludion-original-pom.xml", "/app/pom.xml"]);
    }
  }
  return text;
}

function prepareMavenManifest(directory: string, original: string): void {
  writeFileSync(join(directory, "ludion-original-pom.xml"), original);
  writeFileSync(join(directory, "pom.xml"), acquisitionPom(original));
  writeFileSync(join(directory, "ludion-settings.xml"), MAVEN_SETTINGS);
}

/** Resolve Maven's actual dependency graph without loading application source, extensions, settings or wrappers. */
export async function resolvedMavenInventory(root: string, image: string = DEFAULT_IMAGES.maven, deps: Pick<Dependencies, "command" | "signal"> = {}): Promise<Inventory> {
  const active = () => { if (deps.signal?.aborted) throw new Error("Maven inventory cancelled."); };
  active(); acquisitionPolicy(root, "maven");
  const declared = inventory(root, "maven"), original = textFile(root, "pom.xml");
  if (!/^maven:[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@sha256:[a-f0-9]{64})?$/.test(image)) throw new Error("Use an official Maven tool image.");
  const command = deps.command ?? runDockerImageCommand;
  const temp = mkdtempSync(join(tmpdir(), "ludion-maven-inventory-")), name = `ludion-inventory-${randomUUID()}`;
  try {
    const manifests = join(temp, "manifests"), output = join(temp, "output"); mkdirSync(manifests); mkdirSync(output);
    prepareMavenManifest(manifests, original);
    await command(["pull", image], 300_000); active();
    const digests: unknown = JSON.parse(await command(["image", "inspect", image, "--format", "{{json .RepoDigests}}"], 15_000)); active();
    const digest = Array.isArray(digests) && digests.find(d => typeof d === "string" && /^(?:(?:docker\.io\/)?library\/)?maven@sha256:[a-f0-9]{64}$/.test(d));
    if (!digest) throw new Error("Missing official Maven image digest.");
    writeFileSync(join(temp, "Dockerfile"), resolverDockerfile("maven", `${image.split("@")[0]}@${String(digest).split("@")[1]}`, false, true));
    await command(["build", "--network=default", "--pull=false", "--tag", name, temp], 600_000); active();
    writeFileSync(join(temp, "export.Dockerfile"), `FROM ${name} AS graph\nFROM scratch\nCOPY --from=graph /app/ludion-dependency-tree.json /ludion-dependency-tree.json\n`);
    await command(["build", "--network=none", "--pull=false", "--file", join(temp, "export.Dockerfile"), "--output", `type=local,dest=${output}`, temp], 120_000); active();
    if (textFile(root, "pom.xml") !== original) throw new Error("Maven manifest changed during resolution.");
    return { ...declared, scope: "resolved_dependencies_not_plugins_or_jdk", packages: mavenGraph(jsonFile(output, "ludion-dependency-tree.json"), new Set(declared.packages.map(p => p.name))) };
  } finally {
    await command(["image", "rm", name], 15_000).catch(() => {});
    if (resolve(temp).startsWith(resolve(tmpdir()) + sep)) rmSync(temp, { recursive: true, force: true });
  }
}

/** Top-level names that never reach the tests (the application image's .dockerignore below), so --apply does not compare them. */
const NOT_TESTED = ["node_modules", "vendor", "target", ".npmrc", "auth.json", ".mvn"];

/** One fix per package: every planned change of that package, in plan order. */
export function fixesOf(plan: Change[]): Change[][] {
  const fixes = new Map<string, Change[]>();
  for (const change of plan) fixes.set(change.name, [...(fixes.get(change.name) ?? []), change]);
  return [...fixes.values()];
}

export async function patchDependencies(dir: string, apply: boolean, deps: Dependencies = {}): Promise<{ scan: DependencyScan; receipt: DependencyReceipt | null; path: string | null }> {
  const active = () => { if (deps.signal?.aborted) throw new Error("Update cancelled; pending source changes were not applied."); };
  active();
  const root = rootPath(dir), config = readConfig(root);
  if ("dockerfile" in config) throw new Error("A dependency ecosystem configuration is required.");
  const configText = textFile(root, CONFIG), originalTree = snapshot(root);
  if (JSON.stringify(readConfig(root)) !== JSON.stringify(config)) throw new Error("Update policy changed before scanning.");
  const ecosystem = config.ecosystem, client = deps.client ?? new OsvClient();
  const initial = ecosystem === "maven" ? await resolvedMavenInventory(root, config.image, deps) : inventory(root, ecosystem), scan = await client.scan(initial);
  active();
  if (snapshot(root) !== originalTree || textFile(root, CONFIG) !== configText) throw new Error("Project changed during advisory lookup; rerun the update.");
  if (!scan.findings.length) return { scan, receipt: null, path: null };
  const state = privateState(root), lock = join(state, "patch.lock"), id = randomUUID();
  let fd: number;
  try { fd = openSync(lock, "wx", 0o600); } catch { throw new Error("Another update or interrupted transaction holds patch.lock. Inspect its receipt/journal before retrying."); }
  const receiptPath = join(state, `${id}.json`), images: string[] = [];
  const receipt: DependencyReceipt = {
    schema: 2, id, ecosystem, scope: "dependency_files_only_not_deployed", started_at: new Date().toISOString(), finished_at: "", outcome: "failed", tree_hash: originalTree, config_hash: hash(configText), before: scan, tool_image: "", baseline_image: null, baseline_passed: false, test: [...config.test], base_commit: null,
    fixes: fixesOf(scan.plan).map(changes => ({ package: changes[0]!.name, changes, outcome: "failed", fix_published_at: null, fix_published_note: "Not looked up.", found_at: scan.checked_at, applied_at: null, branch: null, commit: null, candidate_image: null, candidate_passed: false, after: null, files: [] })),
  };
  const save = () => writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  let temp = "";
  const command = deps.command ?? runDockerImageCommand;
  const run = deps.testRun ?? (async (name, image, command, timeoutMs, tool) => {
    const result = await runContainer(name, image, command, timeoutMs, tool);
    if (result.kind === "spawn_error") throw new Error(`Docker unavailable: ${result.message}`);
    if (result.timedOut || result.exitCode !== 0) throw new Error(result.timedOut ? "Application validation timed out." : `Application validation failed (${result.exitCode}): ${result.stderr.slice(-1000)}`);
  });
  try {
    writeFileSync(fd, JSON.stringify({ id, pid: process.pid, started_at: receipt.started_at }));
    temp = mkdtempSync(join(tmpdir(), "ludion-dependencies-"));
    const source = join(temp, "source"); mkdirSync(source);
    if (snapshot(root, source) !== originalTree || hash(textFile(source, CONFIG)) !== receipt.config_hash) throw new Error("Source or update policy changed during advisory lookup.");
    if (initial.limitations.length) throw new Error(initial.limitations.join(" "));
    if (!receipt.fixes.length) throw new Error(scan.blocked.join(" ") || "No fix was planned.");
    // Before any build or test (for Maven, after its dependency graph was resolved): every fix branch starts from the
    // commit whose files are the ones validated.
    const base = apply ? gitBase(root, source, NOT_TESTED) : null;
    receipt.base_commit = base?.commit ?? null;
    const branches = receipt.fixes.map(fix => base && branchName("ludion", ...(base.prefix ? [base.prefix] : []), ecosystem, `${fix.package}-${[...new Set(fix.changes.map(c => c.to))].join("-")}`));
    const subject = (fix: FixReceipt) => `ludion: ${fix.package} ${fix.changes.map(c => `${c.from} -> ${c.to}`).join(", ")} (${ecosystem})`;
    for (const [index, fix] of receipt.fixes.entries()) {
      const branch = branches[index], tip = base && branch ? branchSubject(base, branch) : null;
      // A branch of the same name is this fix only when its tip says so; otherwise the name is taken and the fix stops.
      if (tip === subject(fix)) { fix.outcome = "skipped"; fix.branch = branch!; fix.reason = `The branch ${branch} already exists; this fix was not validated again and the branch was not changed.`; }
      else if (branch && branches.indexOf(branch) !== index) fix.reason = `Another fix of this run has the branch name ${branch}; this fix was not validated.`;
      else if (tip !== null) fix.reason = `The branch ${branch} already exists and holds another change ("${tip.slice(0, 200)}"); it was not changed, and this fix was not validated.`;
    }
    const pending = receipt.fixes.filter(fix => fix.outcome !== "skipped" && !fix.reason);
    acquisitionPolicy(source, ecosystem);
    // No Docker work when every fix already has its branch.
    if (pending.length) {
      const requested = config.image ?? DEFAULT_IMAGES[ecosystem];
      const repo = { npm: "node", composer: "composer", maven: "maven" }[ecosystem];
      if (!new RegExp(`^${repo}:[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@sha256:[a-f0-9]{64})?$`).test(requested)) throw new Error(`Use an official ${repo} tool image; custom registries/images are not accepted by this adapter.`);
      await command(["pull", requested], 300_000); active();
      const digests: unknown = JSON.parse(await command(["image", "inspect", requested, "--format", "{{json .RepoDigests}}"], 15_000)); active();
      const resolved = Array.isArray(digests) && digests.find(d => typeof d === "string" && new RegExp(`^(?:(?:docker\\.io/)?library/)?${repo}@sha256:[a-f0-9]{64}$`).test(d));
      if (!resolved) throw new Error("Official tool image digest is unavailable.");
      receipt.tool_image = `${requested.split("@")[0]}@${String(resolved).split("@")[1]}`;
    }
    /** Acquire one side's dependencies: the baseline (no plan) or one fix's candidate. */
    const acquire = async (label: string, plan: Change[] | null) => {
      active();
      const context = join(temp, label), manifests = join(context, "manifests"), exported = join(temp, `${label}-export`);
      mkdirSync(manifests, { recursive: true }); mkdirSync(exported);
      for (const file of MANIFESTS[ecosystem]) writeFileSync(join(manifests, file), textFile(source, file));
      let finalManifest = "";
      if (plan) {
        finalManifest = changedManifest(source, ecosystem, plan);
        writeFileSync(join(manifests, MANIFESTS[ecosystem][0]), ecosystem === "npm" ? changedManifest(source, ecosystem, plan, true) : finalManifest);
        if (ecosystem === "npm") writeFileSync(join(manifests, NPM_FINAL_MANIFEST), finalManifest);
      }
      if (ecosystem === "maven") prepareMavenManifest(manifests, readFileSync(join(manifests, "pom.xml"), "utf8"));
      writeFileSync(join(context, "Dockerfile"), resolverDockerfile(ecosystem, receipt.tool_image, !!plan, false, plan ?? []));
      const cache = `ludion-cache-${id}-${label}`; images.push(cache);
      // Online phase contains manifests only, never application files or host credentials. Scripts/plugins are disabled where supported.
      await command(["build", "--network=default", "--pull=false", "--target", "resolve", "--tag", cache, context], 600_000); active();
      const exportFile = join(context, "export.Dockerfile");
      const exportedFiles = [...MANIFESTS[ecosystem], ...(ecosystem === "maven" ? ["ludion-dependency-tree.json"] : [])];
      writeFileSync(exportFile, `FROM ${cache} AS captured\nFROM scratch\n${exportedFiles.map(f => `COPY --from=captured /app/${f} /${f}`).join("\n")}\n`);
      await command(["build", "--network=none", "--pull=false", "--file", exportFile, "--output", `type=local,dest=${exported}`, context], 120_000); active();
      acquisitionPolicy(exported, ecosystem);
      let installedCache = cache, archives: ArchiveEvidence[] = [];
      if (ecosystem === "composer") {
        const install = join(temp, `${label}-install`), archiveDir = join(install, "archives"); mkdirSync(install);
        archives = await localComposerLock(exported, archiveDir, join(temp, "archives-cache"), deps.fetchFn, deps.signal); active();
        writeFileSync(join(install, "composer.json"), textFile(exported, "composer.json"));
        cpSync(join(archiveDir, "composer.lock"), join(install, "composer.lock"));
        writeFileSync(join(install, "Dockerfile"), `FROM ${cache}\nUSER root\nRUN mkdir -p /archives && chown 65534:65534 /archives\nWORKDIR /app\nCOPY --chown=65534:65534 archives/ /archives/\nCOPY --chown=65534:65534 composer.json composer.lock /app/\nENV COMPOSER_DISABLE_NETWORK=1\nUSER 65534:65534\nRUN ["composer","install","--no-plugins","--no-scripts","--no-interaction","--prefer-dist","--no-progress"]\n`);
        installedCache = `ludion-installed-${id}-${label}`; images.push(installedCache);
        await command(["build", "--network=none", "--pull=false", "--tag", installedCache, install], 300_000); active();
      }
      const resolvedInventory = inventory(exported, ecosystem);
      if (ecosystem === "maven") {
        const direct = new Set(resolvedInventory.packages.map(p => p.name));
        resolvedInventory.packages = mavenGraph(jsonFile(exported, "ludion-dependency-tree.json"), direct);
        resolvedInventory.scope = "resolved_dependencies_not_plugins_or_jdk";
      }
      if (plan && ecosystem !== "maven" && textFile(exported, MANIFESTS[ecosystem][0]) !== finalManifest) throw new Error("The package manager changed the manifest beyond the planned fix.");
      return { exported, installedCache, archives, inventory: resolvedInventory };
    };
    /** Build the application on one side's dependencies and run the project's test in the sandbox. Returns the image id. */
    const test = async (label: string, exported: string, installedCache: string) => {
      const app = join(temp, `${label}-app`); mkdirSync(app);
      cpSync(source, app, { recursive: true });
      // Installed dependency caches stay in the prepared image, not in the source COPY layer.
      writeFileSync(join(app, ".dockerignore"), "node_modules\nvendor\ntarget\n.ludion\n.git\n.env\n.env.*\n.npmrc\nauth.json\n.mvn\n");
      for (const file of MANIFESTS[ecosystem]) writeFileSync(join(app, file), textFile(exported, file));
      writeFileSync(join(app, "Dockerfile.ludion"), `FROM ${installedCache}\nWORKDIR /app\nCOPY --chown=65534:65534 . /app\nUSER 65534:65534\n`);
      const image = `ludion-application-${id}-${label}`; images.push(image);
      await command(["build", "--network=none", "--pull=false", "--file", join(app, "Dockerfile.ludion"), "--tag", image, app], 300_000); active();
      const imageId = await command(["image", "inspect", image, "--format", "{{.Id}}"], 15_000); active();
      await run(`ludion-check-${id}-${label}`, imageId, config.test, config.timeout_seconds * 1000, ecosystem); active();
      return imageId;
    };
    const baseline = pending.length ? await acquire("baseline", null) : null;
    if (baseline) {
      for (const file of MANIFESTS[ecosystem]) if (textFile(baseline.exported, file) !== textFile(source, file)) throw new Error("Baseline acquisition changed a dependency file.");
      if (baseline.archives.length) receipt.archives = baseline.archives;
      receipt.baseline_image = await test("baseline", baseline.exported, baseline.installedCache);
      receipt.baseline_passed = true;
    }
    // Another fix's package may move within its advisory (Maven does not hold the graph fixed); that advisory is that fix's.
    const known = new Set(scan.findings.map(f => `${f.package.name} ${f.advisory.id}`));
    const unversioned = (blocked: string) => blocked.replace(/^(.+?)@[^@:\s]+:/, "$1:"), knownBlocked = new Set(scan.blocked.map(unversioned));
    for (const [index, fix] of receipt.fixes.entries()) {
      if (!baseline || fix.outcome === "skipped" || fix.reason) continue;
      try {
        active();
        const blocked = scan.blocked.filter(b => b.startsWith(`${fix.package}@`));
        if (blocked.length) throw new Error(`This package also has a finding without a supported fix: ${blocked.join(" ")}`);
        const branch = branches[index];
        const published = await dependencyFixPublished(ecosystem, fix.changes, deps.fetchFn); active();
        fix.fix_published_at = published.at; fix.fix_published_note = published.note;
        const label = `candidate-${index + 1}`, candidate = await acquire(label, fix.changes);
        if (candidate.archives.length) fix.archives = candidate.archives;
        fix.changed_packages = changedPackages(baseline.inventory, candidate.inventory);
        if (ecosystem !== "maven") {
          const moved = unplannedRemovals(baseline.inventory, candidate.inventory, fix.changes);
          if (moved.length) throw new Error(`The candidate also moved packages that were not planned (${moved.slice(0, 10).join(", ")}${moved.length > 10 ? ", ..." : ""}); that needs review.`);
          const cap = fix.time_cap = await candidateTimeCap(ecosystem, baseline.inventory, candidate.inventory, fix.changes, deps.fetchFn); active();
          if (cap.undecidable.length) throw new Error(`The time cap could not be checked: ${cap.undecidable.slice(0, 5).join(" ")}`);
          if (cap.after_t.length || cap.young.length) throw new Error(`The candidate breaks the time cap. ${renderTimeCap(cap).join(" ")}${cap.young.length ? ` New dependencies first published less than ${cap.wait_hours}h before T: ${cap.young.join(", ")}.` : ""}`);
        }
        compatible(baseline.inventory, candidate.inventory);
        // This fix's package must have no finding left, and no package may have an advisory the baseline did not have on it.
        const after = fix.after = await client.scan(candidate.inventory); active();
        const versioned = new Set(scan.findings.map(f => `${f.package.name}@${f.package.version} ${f.advisory.id}`));
        const carried = after.findings.filter(f => f.package.name !== fix.package && !versioned.has(`${f.package.name}@${f.package.version} ${f.advisory.id}`)).map(f => `${f.package.name}@${f.package.version} ${f.advisory.id}`);
        if (carried.length) fix.carried_findings = carried;
        const left = after.findings.filter(f => f.package.name === fix.package || !known.has(`${f.package.name} ${f.advisory.id}`)).map(f => `${f.package.name}@${f.package.version} ${f.advisory.id}`);
        const unfixable = after.blocked.filter(b => b.startsWith(`${fix.package}@`) || !knownBlocked.has(unversioned(b)));
        if (left.length || unfixable.length || after.inventory.limitations.length) throw new Error(`Candidate still contains known advisory findings or incomplete inventory${left.length ? ` (${left.slice(0, 5).join(", ")})` : ""}; no source change was made.`);
        const files = MANIFESTS[ecosystem].map(path => ({ path, before: textFile(source, path), after: textFile(candidate.exported, path) })).filter(f => f.before !== f.after);
        if (!files.length) throw new Error("No dependency file changed.");
        fix.candidate_image = await test(label, candidate.exported, candidate.installedCache);
        fix.candidate_passed = true;
        if (snapshot(root) !== receipt.tree_hash) throw new Error("Project changed during validation; no dependency file was updated.");
        fix.files = files.map(f => ({ path: f.path, before_hash: hash(f.before), after_hash: hash(f.after) }));
        fix.outcome = "validated";
        // Persist the validation evidence before making the branch.
        save();
        if (base && branch) {
          active();
          const advisories = [...new Set(fix.changes.flatMap(c => c.advisories))];
          const message = `${subject(fix)}\n\nFixes ${advisories.join(", ")}.\n\nLudion receipt ${id}: the project's test passed on ${base.commit.slice(0, 12)} and on this change alone, offline in Docker.\nSource dependency files only; production was not changed.\n`;
          fix.commit = fixBranch(base, branch, files.map(f => ({ path: f.path, content: f.after })), message);
          fix.branch = branch; fix.applied_at = new Date().toISOString(); fix.outcome = "applied";
        }
      } catch (error) { fix.outcome = "failed"; fix.reason = error instanceof Error ? error.message : String(error); }
      finally { save(); }
    }
    const done = receipt.fixes.filter(f => f.outcome !== "skipped"), failed = done.filter(f => f.outcome === "failed").length;
    const unplanned = scan.blocked.filter(b => !receipt.fixes.some(f => b.startsWith(`${f.package}@`)));
    receipt.outcome = done.length && failed === done.length ? "failed" : failed || unplanned.length ? "partial" : !done.length ? "skipped" : apply ? "applied" : "validated";
    const notes = [...(unplanned.length ? [`Findings without a supported fix: ${unplanned.join(" ")}`] : []), ...(done.length ? [] : ["Every fix already has its branch; nothing was validated again."])];
    if (notes.length) receipt.reason = notes.join(" ");
  } catch (error) {
    receipt.outcome = "failed"; receipt.reason = error instanceof Error ? error.message : String(error);
    for (const fix of receipt.fixes) if (fix.outcome === "failed" && !fix.reason) fix.reason = `Not validated: ${receipt.reason}`;
  }
  finally {
    receipt.finished_at = new Date().toISOString();
    try { save(); }
    finally {
      for (const image of images.reverse()) await command(["image", "rm", image], 15_000).catch(() => {});
      if (temp && resolve(temp).startsWith(resolve(tmpdir()) + sep)) rmSync(temp, { recursive: true, force: true });
      closeSync(fd); rmSync(lock);
    }
  }
  return { scan, receipt, path: receiptPath };
}
