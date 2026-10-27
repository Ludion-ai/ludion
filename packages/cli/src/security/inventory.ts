import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import semver from "semver";
import { fromPackageLock, fromPnpmLock, fromYarnLock } from "../lockfile.ts";
import { regularFile } from "./project.ts";

export type Ecosystem = "npm" | "composer" | "maven";
export const OSV_NAMES = { npm: "npm", composer: "Packagist", maven: "Maven" } as const;
export type Package = { ecosystem: Ecosystem; name: string; version: string; direct: boolean };
export type Inventory = { ecosystem: Ecosystem; files: string[]; scope: string; packages: Package[]; limitations: string[] };
export type Change = { name: string; from: string; to: string; advisories: string[] };
export const MANIFESTS = { npm: ["package.json", "package-lock.json"], composer: ["composer.json", "composer.lock"], maven: ["pom.xml"] } as const;
export const DEFAULT_IMAGES = { npm: "node:24-slim", composer: "composer:2", maven: "maven:3.9-eclipse-temurin-21" } as const;

export function textFile(root: string, name: string): string {
  const path = regularFile(root, name);
  if (lstatSync(path).size > 4 * 1024 * 1024) throw new Error(`${name} exceeds 4 MiB.`);
  return readFileSync(path, "utf8");
}
export function jsonFile(root: string, name: string): Record<string, any> {
  const value: unknown = JSON.parse(textFile(root, name));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}.`);
  return value as Record<string, any>;
}
const namePattern = { npm: /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i, composer: /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i, maven: /^[a-zA-Z0-9_.-]+:[a-zA-Z0-9_.-]+$/ };
export function packageEntry(ecosystem: Ecosystem, name: unknown, version: unknown, direct: boolean): Package {
  if (typeof name !== "string" || name.length > 240 || !namePattern[ecosystem].test(name) || typeof version !== "string" || version.length > 100 || !/^v?\d[0-9A-Za-z.+_-]*$/.test(version)) throw new Error(`Unresolved or invalid ${ecosystem} package coordinate.`);
  return { ecosystem, name, version: version.replace(/^v(?=\d)/, ""), direct };
}
const unique = (packages: Package[]): Package[] => [...new Map(packages.map(p => [`${p.name}\0${p.version}`, p])).values()];

function children(element: Element, name: string): Element[] {
  return Array.from(element.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).localName === name);
}
function child(element: Element, name: string): Element | undefined { return children(element, name)[0]; }
function value(element: Element, name: string): string | undefined { return child(element, name)?.textContent?.trim(); }
export function parsePom(text: string): { document: Document; project: Element; dependencies: { element: Element; name: string; version: string }[]; limitations: string[] } {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("DTD/entity declarations are not supported in Maven manifests.");
  const document = new DOMParser({ onError: level => { throw new Error(`Invalid Maven XML (${level}).`); } }).parseFromString(text, "application/xml");
  const project = document.documentElement;
  if (!project || project.localName !== "project" || (project.namespaceURI && project.namespaceURI !== "http://maven.apache.org/POM/4.0.0")) throw new Error("Expected a Maven POM project.");
  const props = new Map<string, string>();
  const properties = child(project, "properties");
  if (properties) for (const node of Array.from(properties.childNodes)) if (node.nodeType === 1) props.set((node as Element).localName ?? node.nodeName, node.textContent?.trim() ?? "");
  const limitations: string[] = [];
  if (child(project, "parent")) limitations.push("Maven parent inheritance is not resolved by the static scan.");
  if (child(project, "profiles")) limitations.push("Maven profile dependencies are not resolved by the static scan.");
  if (child(project, "modules")) limitations.push("Maven modules must be registered individually.");
  const dependencies: { element: Element; name: string; version: string }[] = [];
  for (const element of children(child(project, "dependencies") ?? document.createElement("dependencies"), "dependency")) {
    const group = value(element, "groupId"), artifact = value(element, "artifactId");
    const raw = value(element, "version");
    const version = raw?.replace(/\$\{([^}]+)\}/g, (_all, key: string) => props.get(key) ?? `\${${key}}`);
    if (!group || !artifact || !version || version.includes("${") || /[\[\](),]/.test(version)) { limitations.push(`Unresolved Maven dependency: ${group ?? "?"}:${artifact ?? "?"}.`); continue; }
    const pkg = packageEntry("maven", `${group}:${artifact}`, version, true);
    dependencies.push({ element, name: pkg.name, version: pkg.version });
  }
  return { document, project, dependencies, limitations };
}

export function mavenGraph(input: unknown, direct: Set<string>): Package[] {
  const packages: Package[] = []; let count = 0;
  const visit = (value: any, depth: number, root: boolean) => {
    if (!value || typeof value !== "object" || depth > 100 || ++count > 2000) throw new Error("Invalid or oversized resolved Maven dependency graph.");
    if (!root) packages.push(packageEntry("maven", `${value.groupId}:${value.artifactId}`, value.version, direct.has(`${value.groupId}:${value.artifactId}`)));
    if (value.children !== undefined && !Array.isArray(value.children)) throw new Error("Invalid Maven graph children.");
    for (const next of value.children ?? []) visit(next, depth + 1, false);
  };
  visit(input, 0, true);
  if ([...direct].some(name => !packages.some(p => p.name === name))) throw new Error("Resolved Maven graph is missing a declared dependency.");
  return unique(packages);
}

export function inventory(root: string, ecosystem: Ecosystem): Inventory {
  const limitations: string[] = [];
  let packages: Package[] = [], files: string[];
  if (ecosystem === "npm") {
    const manifest = jsonFile(root, "package.json");
    const direct = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }));
    const readers = [["package-lock.json", fromPackageLock], ["pnpm-lock.yaml", fromPnpmLock], ["yarn.lock", fromYarnLock]] as const;
    const reader = readers.find(([file]) => existsSync(join(root, file)));
    if (!reader) throw new Error("npm requires a package-lock.json, pnpm-lock.yaml or yarn.lock; unresolved package.json ranges are not scanned as installed versions.");
    files = ["package.json", reader[0]];
    const text = textFile(root, reader[0]);
    const parsed = reader[1](text);
    if (reader[0] !== "package-lock.json") limitations.push("pnpm/yarn detection is supported; automatic dependency patching currently requires package-lock.json.");
    if (reader[0] === "package-lock.json") {
      const lock = JSON.parse(text);
      if (!lock.packages || ![2, 3].includes(lock.lockfileVersion)) throw new Error("Security scanning requires package-lock v2/v3.");
      for (const [path, item] of Object.entries(lock.packages) as [string, any][]) {
        if (!path.includes("node_modules/")) continue;
        if (item.link) { limitations.push(`Local linked package is outside registry advisory coverage: ${path}.`); continue; }
        if (typeof item.version !== "string" || !semver.valid(item.version)) throw new Error(`Invalid exact npm version in ${path}.`);
      }
    }
    const rootVersions = reader[0] === "package-lock.json" ? JSON.parse(text).packages : undefined;
    for (const [name, versions] of parsed) for (const version of versions) packages.push(packageEntry(ecosystem, name, version, direct.has(name) && (!rootVersions || rootVersions[`node_modules/${name}`]?.version === version)));
    for (const name of direct) {
      if (!packages.some(p => p.name === name && p.direct)) limitations.push(`No installed registry version found for ${name}.`);
      if (rootVersions?.[`node_modules/${name}`]?.version) {
        const spec = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name] ?? manifest.optionalDependencies?.[name];
        if (semver.validRange(spec) && !semver.satisfies(rootVersions[`node_modules/${name}`].version, spec)) throw new Error(`Lockfile does not satisfy the direct requirement: ${name}.`);
      }
    }
  } else if (ecosystem === "composer") {
    const manifest = jsonFile(root, "composer.json"), lock = jsonFile(root, "composer.lock");
    const direct = new Set(Object.keys({ ...manifest.require, ...manifest["require-dev"] }));
    if (!Array.isArray(lock.packages) || (lock["packages-dev"] !== undefined && !Array.isArray(lock["packages-dev"]))) throw new Error("Invalid Composer lockfile package list.");
    files = [...MANIFESTS.composer];
    packages = [...lock.packages, ...(lock["packages-dev"] ?? [])].map((p: any) => packageEntry(ecosystem, p.name, p.version, direct.has(p.name)));
    for (const name of direct) if (name.includes("/") && !packages.some(p => p.name === name)) limitations.push(`No locked package found for ${name}.`);
  } else {
    const pom = parsePom(textFile(root, "pom.xml"));
    files = ["pom.xml"];
    limitations.push(...pom.limitations);
    packages = pom.dependencies.map(p => packageEntry(ecosystem, p.name, p.version, true));
  }
  packages = unique(packages);
  if (packages.length > 2000) throw new Error("Advisory scan exceeds 2,000 distinct installed package versions.");
  return { ecosystem, files, scope: ecosystem === "maven" ? "declared_dependencies_not_transitives_plugins_or_jdk" : "locked_dependencies", packages, limitations };
}

export function detectEcosystems(root: string): Ecosystem[] {
  const found: Ecosystem[] = [];
  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].some(f => existsSync(join(root, f)))) found.push("npm");
  if (existsSync(join(root, "composer.lock"))) found.push("composer");
  if (existsSync(join(root, "pom.xml"))) found.push("maven");
  return found;
}

/**
 * A direct requirement raised to the fixed version in the project's own style: an exact pin stays exact, ^ stays ^ and
 * ~x.y.z stays ~, with the fixed version as the new floor. Any other style (ranges, wildcards, ||) needs review.
 */
export function raisedRequirement(name: string, spec: unknown, to: string): string {
  if (!semver.valid(to) || semver.prerelease(to)) throw new Error("An exact stable fixed-version floor is required.");
  const text = typeof spec === "string" ? spec.trim() : "";
  if (/^=?v?\d+\.\d+\.\d+$/.test(text)) return to;
  if (/^\^v?\d+(?:\.\d+){0,2}$/.test(text)) return `^${to}`;
  // ~ only with all three parts: Composer's ~1.2 allows <2.0, so ~1.2.5 would narrow it.
  if (/^~v?\d+\.\d+\.\d+$/.test(text)) return `~${to}`;
  throw new Error(`${name}'s requirement ${JSON.stringify(spec)} is not an exact version, ^ or ~; raising it keeps its meaning only with review.`);
}

/**
 * Change declared direct versions only. Package managers resolve the dependency graph; no hand-written lockfile surgery.
 * pinned (npm only) is the first resolution step: direct fixes as exact versions and transitive fixes as overrides, so
 * npm records exactly the fixed version. The final manifest then keeps the project's own requirement style, and a
 * second lockfile-only install keeps the recorded versions because they satisfy it.
 */
export function changedManifest(root: string, ecosystem: Ecosystem, changes: Change[], pinned = false): string {
  if (ecosystem === "maven") {
    const pom = parsePom(textFile(root, "pom.xml"));
    if (pom.limitations.length) throw new Error(pom.limitations.join(" "));
    for (const change of changes) for (const dependency of pom.dependencies.filter(p => p.name === change.name && p.version === change.from)) {
      child(dependency.element, "version")!.textContent = change.to;
    }
    // Maven has no lockfile: constrain a vulnerable transitive dependency through dependencyManagement.
    // Resolved-graph compatibility and advisory checks still gate the resulting source change.
    const append = (parent: Element, name: string, text?: string): Element => {
      const node = pom.document.createElementNS(pom.project.namespaceURI, name);
      if (text !== undefined) node.textContent = text;
      parent.appendChild(node); return node;
    };
    for (const change of changes.filter(c => !pom.dependencies.some(p => p.name === c.name))) {
      const management = child(pom.project, "dependencyManagement") ?? append(pom.project, "dependencyManagement");
      const dependencies = child(management, "dependencies") ?? append(management, "dependencies");
      const [group, artifact] = change.name.split(":");
      const existing = children(dependencies, "dependency").find(d => value(d, "groupId") === group && value(d, "artifactId") === artifact);
      const dependency = existing ?? append(dependencies, "dependency");
      if (!existing) { append(dependency, "groupId", group!); append(dependency, "artifactId", artifact!); }
      const version = child(dependency, "version") ?? append(dependency, "version"); version.textContent = change.to;
    }
    return new XMLSerializer().serializeToString(pom.document);
  }
  const name = MANIFESTS[ecosystem][0], manifest = jsonFile(root, name);
  const groups = ecosystem === "npm" ? ["dependencies", "devDependencies", "optionalDependencies"] : ["require", "require-dev"];
  // Several vulnerable versions of one transitive npm name each get their own scoped override. A direct requirement,
  // or a Composer package, has one version to raise.
  const repeated = changes.map(c => c.name).filter((n, i, all) => all.indexOf(n) !== i)
    .filter(n => ecosystem !== "npm" || groups.some(group => manifest[group]?.[n] !== undefined));
  if (repeated.length) throw new Error(`More than one installed version of ${[...new Set(repeated)].join(", ")} needs a fix; that needs review.`);
  // A requirement in the manifest is the fix only when its installed root copy is the vulnerable one. A vulnerable
  // nested copy of a direct dependency cannot be fixed by raising the requirement or by an override.
  if (ecosystem === "npm" && existsSync(join(root, "package-lock.json"))) {
    const locked = jsonFile(root, "package-lock.json").packages ?? {};
    for (const change of changes) {
      const rootVersion = locked[`node_modules/${change.name}`]?.version;
      if (groups.some(group => manifest[group]?.[change.name] !== undefined) && rootVersion !== change.from) {
        throw new Error(`The vulnerable ${change.name}@${change.from} is a nested copy of a direct dependency (the project's own copy is ${rootVersion ?? "missing"}); that needs review.`);
      }
    }
  }
  const direct = new Set<string>();
  for (const group of groups) {
    for (const change of changes) if (manifest[group]?.[change.name] !== undefined) {
      const raised = raisedRequirement(change.name, manifest[group][change.name], change.to);
      manifest[group][change.name] = pinned ? change.to : raised;
      direct.add(change.name);
    }
  }
  if (pinned && ecosystem === "npm") {
    const transitive = changes.filter(c => !direct.has(c.name));
    if (transitive.length) {
      const overrides = manifest.overrides ?? {};
      if (typeof overrides !== "object" || Array.isArray(overrides)) throw new Error("Invalid npm overrides.");
      // Every key at any depth: a nested override ({"parent": {"semver": ...}}) also decides the version.
      const own: string[] = [];
      const keys = (value: unknown): void => { if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { own.push(key.replace(/^\$/, "")); keys(inner); } };
      keys(overrides);
      for (const change of transitive) {
        if (own.some(key => key === change.name || key.startsWith(`${change.name}@`))) throw new Error(`The project already overrides ${change.name}; the fix needs review.`);
        // Scoped to the vulnerable version: other installed versions of the same name keep their own resolution.
        overrides[`${change.name}@${change.from}`] = change.to;
      }
      manifest.overrides = overrides;
    }
  }
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
