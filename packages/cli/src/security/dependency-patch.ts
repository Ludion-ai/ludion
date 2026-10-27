import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import semver from "semver";
import { runContainer, runDockerImageCommand, type Tool } from "../../../sandbox/src/docker.ts";
import { changedManifest, DEFAULT_IMAGES, inventory, jsonFile, MANIFESTS, mavenGraph, parsePom, textFile, type Ecosystem, type Inventory } from "./inventory.ts";
import { comparableVersion, OsvClient, type DependencyScan } from "./osv.ts";
import { hash } from "./php.ts";
import { CONFIG, privateState, readConfig, regularFile, rootPath, snapshot, type DependencyConfig } from "./project.ts";
import { acquisitionPom, localComposerLock, MAVEN_SETTINGS, publicArchiveUrl, type ArchiveEvidence } from "./acquisition.ts";

export type DependencyReceipt = {
  schema: 1; id: string; ecosystem: Ecosystem; scope: "dependency_files_only_not_deployed";
  started_at: string; finished_at: string; outcome: "failed" | "validated" | "applied";
  tree_hash: string; config_hash: string; before: DependencyScan; after: DependencyScan | null;
  tool_image: string; baseline_image: string | null; candidate_image: string | null;
  baseline_passed: boolean; candidate_passed: boolean; test: string[];
  files: { path: string; before_hash: string; after_hash: string }[];
  reason?: string; recovery_journal?: string;
  archives?: ArchiveEvidence[];
};
type Dependencies = { client?: OsvClient; fetchFn?: typeof fetch; signal?: AbortSignal; command?: typeof runDockerImageCommand; testRun?: (name: string, image: string, command: readonly string[], timeoutMs: number, tool: Tool) => Promise<void> };

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

export function resolverDockerfile(ecosystem: Ecosystem, image: string, candidate: boolean, inventoryOnly = false): string {
  const run = (args: string[]) => `RUN ${JSON.stringify(args)}\n`;
  let text = `FROM ${image} AS resolve\nUSER root\nRUN mkdir -p /app /opt/ludion-m2 && chown -R 65534:65534 /app /opt/ludion-m2\nWORKDIR /app\nENV HOME=/tmp COMPOSER_HOME=/tmp/composer MAVEN_CONFIG=/tmp/maven NPM_CONFIG_CACHE=/tmp/npm\n`;
  if (ecosystem === "npm") {
    text += run(["npm", "install", "--global", "npm@12.2.1", "--ignore-scripts", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org"]);
    text += run(["chown", "-R", "65534:65534", "/tmp/npm"]);
  }
  text += "COPY --chown=65534:65534 manifests/ ./\nUSER 65534:65534\n";
  if (ecosystem === "npm") {
    text += run(["node", "-e", "if(require('/usr/local/lib/node_modules/npm/package.json').version!=='12.2.1')process.exit(1)"]);
    text += run(["npm", candidate ? "update" : "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--allow-git=none", "--allow-remote=none", "--allow-file=none", "--allow-directory=none", "--registry=https://registry.npmjs.org"]);
  }
  else if (ecosystem === "composer" && candidate) text += run(["composer", "update", "--no-install", "--no-plugins", "--no-scripts", "--no-interaction", "--prefer-dist", "--no-progress", "--with-all-dependencies"]);
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

/** A journal makes a multi-file source update recoverable. On ordinary write errors, roll back our own writes only. */
export function applyFiles(root: string, state: string, id: string, files: { path: string; before: string; after: string }[], rename = renameSync): string {
  const dir = join(state, `transaction-${id}`); mkdirSync(dir, { mode: 0o700 });
  const journal = join(dir, "journal.json");
  const entries = files.map(f => ({ path: f.path, before_hash: hash(f.before), after_hash: hash(f.after), mode: lstatSync(regularFile(root, f.path)).mode & 0o777 }));
  const completed: typeof files = [];
  for (const f of files) {
    const target = regularFile(root, f.path);
    if (readFileSync(target, "utf8") !== f.before) throw new Error("Dependency files changed before application.");
    writeFileSync(join(dir, `${f.path}.before`), f.before, { flag: "wx", mode: 0o600 });
    writeFileSync(join(dir, `${f.path}.next`), f.after, { flag: "wx", mode: lstatSync(target).mode & 0o777 });
    chmodSync(join(dir, `${f.path}.next`), lstatSync(target).mode & 0o777);
  }
  const record = (phase: string) => writeFileSync(journal, `${JSON.stringify({ schema: 1, phase, files: entries, applied: completed.map(f => f.path) }, null, 2)}\n`, { mode: 0o600 });
  record("prepared");
  try {
    for (const file of files) { rename(join(dir, `${file.path}.next`), regularFile(root, file.path)); completed.push(file); record("applying"); }
    record("complete");
  } catch (error) {
    let failed = false;
    for (const f of [...completed].reverse()) {
      try {
        if (hash(readFileSync(regularFile(root, f.path))) !== hash(f.after)) throw new Error("Concurrent change prevents rollback.");
        rename(join(dir, `${f.path}.before`), join(root, f.path));
        chmodSync(join(root, f.path), entries.find(e => e.path === f.path)!.mode);
      } catch { failed = true; }
    }
    record(failed ? "manual_recovery_required" : "rolled_back");
    throw new Error(`${error instanceof Error ? error.message : String(error)} ${failed ? "Partial update: manual recovery required." : "Our source changes were rolled back."} Journal: ${journal}`);
  }
  return journal;
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
  const receipt: DependencyReceipt = { schema: 1, id, ecosystem, scope: "dependency_files_only_not_deployed", started_at: new Date().toISOString(), finished_at: "", outcome: "failed", tree_hash: originalTree, config_hash: hash(configText), before: scan, after: null, tool_image: "", baseline_image: null, candidate_image: null, baseline_passed: false, candidate_passed: false, test: [...config.test], files: [] };
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
    if (scan.blocked.length) throw new Error(scan.blocked.join(" "));
    acquisitionPolicy(source, ecosystem);
    const requested = config.image ?? DEFAULT_IMAGES[ecosystem];
    const repo = { npm: "node", composer: "composer", maven: "maven" }[ecosystem];
    if (!new RegExp(`^${repo}:[a-zA-Z0-9][a-zA-Z0-9._-]*(?:@sha256:[a-f0-9]{64})?$`).test(requested)) throw new Error(`Use an official ${repo} tool image; custom registries/images are not accepted by this adapter.`);
    await command(["pull", requested], 300_000); active();
    const digests: unknown = JSON.parse(await command(["image", "inspect", requested, "--format", "{{json .RepoDigests}}"], 15_000)); active();
    const resolved = Array.isArray(digests) && digests.find(d => typeof d === "string" && new RegExp(`^(?:(?:docker\\.io/)?library/)?${repo}@sha256:[a-f0-9]{64}$`).test(d));
    if (!resolved) throw new Error("Official tool image digest is unavailable.");
    receipt.tool_image = `${requested.split("@")[0]}@${String(resolved).split("@")[1]}`;
    let baselineInventory = initial;
    let candidateFiles: { path: string; before: string; after: string }[] = [];
    for (const label of ["baseline", "candidate"] as const) {
      active();
      const context = join(temp, label), manifests = join(context, "manifests"), exported = join(temp, `${label}-export`), app = join(temp, `${label}-app`);
      mkdirSync(manifests, { recursive: true }); mkdirSync(exported); mkdirSync(app);
      for (const file of MANIFESTS[ecosystem]) writeFileSync(join(manifests, file), textFile(source, file));
      if (label === "candidate") writeFileSync(join(manifests, MANIFESTS[ecosystem][0]), changedManifest(source, ecosystem, scan.plan));
      if (ecosystem === "maven") prepareMavenManifest(manifests, readFileSync(join(manifests, "pom.xml"), "utf8"));
      writeFileSync(join(context, "Dockerfile"), resolverDockerfile(ecosystem, receipt.tool_image, label === "candidate"));
      const cache = `ludion-cache-${id}-${label}`; images.push(cache);
      // Online phase contains manifests only, never application files or host credentials. Scripts/plugins are disabled where supported.
      await command(["build", "--network=default", "--pull=false", "--target", "resolve", "--tag", cache, context], 600_000); active();
      const exportFile = join(context, "export.Dockerfile");
      const exportedFiles = [...MANIFESTS[ecosystem], ...(ecosystem === "maven" ? ["ludion-dependency-tree.json"] : [])];
      writeFileSync(exportFile, `FROM ${cache} AS captured\nFROM scratch\n${exportedFiles.map(f => `COPY --from=captured /app/${f} /${f}`).join("\n")}\n`);
      await command(["build", "--network=none", "--pull=false", "--file", exportFile, "--output", `type=local,dest=${exported}`, context], 120_000); active();
      acquisitionPolicy(exported, ecosystem);
      let installedCache = cache;
      if (ecosystem === "composer") {
        const install = join(temp, `${label}-install`), archives = join(install, "archives"); mkdirSync(install);
        receipt.archives = [...(receipt.archives ?? []), ...await localComposerLock(exported, archives, join(temp, "archives-cache"), deps.fetchFn, deps.signal)]; active();
        writeFileSync(join(install, "composer.json"), textFile(exported, "composer.json"));
        cpSync(join(archives, "composer.lock"), join(install, "composer.lock"));
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
      if (label === "baseline") {
        for (const file of MANIFESTS[ecosystem]) if (textFile(exported, file) !== textFile(source, file)) throw new Error("Baseline acquisition changed a dependency file.");
        baselineInventory = resolvedInventory;
      } else {
        compatible(baselineInventory, resolvedInventory);
        receipt.after = await client.scan(resolvedInventory); active();
        if (receipt.after.findings.length || receipt.after.inventory.limitations.length) throw new Error("Candidate still contains known advisory findings or incomplete inventory; no source changes applied.");
        candidateFiles = MANIFESTS[ecosystem].map(path => ({ path, before: textFile(source, path), after: textFile(exported, path) })).filter(f => f.before !== f.after);
        if (!candidateFiles.length) throw new Error("No dependency file changed.");
      }
      cpSync(source, app, { recursive: true });
      // Installed dependency caches stay in the prepared image, not in the source COPY layer.
      writeFileSync(join(app, ".dockerignore"), "node_modules\nvendor\ntarget\n.ludion\n.git\n.env\n.env.*\n.npmrc\nauth.json\n.mvn\n");
      for (const file of MANIFESTS[ecosystem]) writeFileSync(join(app, file), textFile(exported, file));
      writeFileSync(join(app, "Dockerfile.ludion"), `FROM ${installedCache}\nWORKDIR /app\nCOPY --chown=65534:65534 . /app\nUSER 65534:65534\n`);
      const image = `ludion-application-${id}-${label}`; images.push(image);
      await command(["build", "--network=none", "--pull=false", "--file", join(app, "Dockerfile.ludion"), "--tag", image, app], 300_000); active();
      const imageId = await command(["image", "inspect", image, "--format", "{{.Id}}"], 15_000); active();
      if (label === "baseline") receipt.baseline_image = imageId; else receipt.candidate_image = imageId;
      const name = `ludion-check-${id}-${label}`;
      await run(name, imageId, config.test, config.timeout_seconds * 1000, ecosystem); active();
      if (label === "baseline") receipt.baseline_passed = true; else receipt.candidate_passed = true;
    }
    if (snapshot(root) !== receipt.tree_hash) throw new Error("Project changed during validation; no dependency file was updated.");
    active();
    receipt.files = candidateFiles.map(f => ({ path: f.path, before_hash: hash(f.before), after_hash: hash(f.after) }));
    receipt.outcome = "validated";
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if (apply) { active(); receipt.recovery_journal = join(state, `transaction-${id}`, "journal.json"); applyFiles(root, state, id, candidateFiles); receipt.outcome = "applied"; }
  } catch (error) { receipt.outcome = "failed"; receipt.reason = error instanceof Error ? error.message : String(error); }
  finally {
    receipt.finished_at = new Date().toISOString();
    try { writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 }); }
    finally {
      for (const image of images.reverse()) await command(["image", "rm", image], 15_000).catch(() => {});
      if (temp && resolve(temp).startsWith(resolve(tmpdir()) + sep)) rmSync(temp, { recursive: true, force: true });
      closeSync(fd); rmSync(lock);
    }
  }
  return { scan, receipt, path: receiptPath };
}
