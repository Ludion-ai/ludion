import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectEcosystems, inventory, textFile, type Ecosystem } from "./inventory.ts";
import { resolvedMavenInventory } from "./dependency-patch.ts";
import { OsvClient, type DependencyScan, type ReadOnlyScan } from "./osv.ts";
import { ImageMoveStopped, scanPhp, type Release, type Scan } from "./php.ts";
import { namesNodeImage, scanNode } from "./node.ts";
import { CONFIG, readConfig } from "./project.ts";
import { isReadOnlyCliName, READONLY_CLI_NAMES, READONLY_READERS, type ReadOnlyReader } from "./readonly/index.ts";
import type { ReadOnlyEcosystem } from "./readonly/types.ts";

export type ProjectScan = { schema: 1; checked_at: string; status: "attention_required" | "no_known_updates"; checks: ({ ecosystem: "php" | "node"; result: Scan } | { ecosystem: Ecosystem; result: DependencyScan } | { ecosystem: ReadOnlyEcosystem; result: ReadOnlyScan } | { ecosystem: string; error: string; security_releases?: Release[] })[]; unsupported: string[] };
/** Inventories scan does not read. A file a registered read-only reader handled is left out. */
const UNSUPPORTED = ["requirements.txt", "pyproject.toml", "go.mod", "Cargo.lock", "build.gradle", "build.gradle.kts"];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
/** A known vulnerability: any finding of a dependency scan; a read-only scan's informational findings do not count. */
export const vulnerable = (result: DependencyScan | ReadOnlyScan): boolean => "fixed_versions_note" in result ? result.findings.some(f => f.kind === "vulnerability") : result.findings.length > 0;
/**
 * An image move that scan counts (exit 1, attention_required): one with a newer security release between. A move to the
 * line's newest release with none, waiting or not, is shown but not counted (docs/decisions/2026-11-01-scan-exit-non-security-move.md).
 */
export const securityMove = (result: Scan): boolean => result.candidate !== null && result.security_releases.length > 0;
/**
 * What scan exits 1 for: a known vulnerability, a counted image move, or an image check stopped at Docker Hub (no tag for
 * the move, or Docker Hub could not be checked; php.ts, ImageMoveStopped) while a newer security release lies between,
 * which the check keeps.
 */
export const found = (check: ProjectScan["checks"][number]): boolean => "result" in check
  ? "findings" in check.result ? vulnerable(check.result) : securityMove(check.result)
  : (check.security_releases?.length ?? 0) > 0;
/** A failed image check; a stop at Docker Hub keeps the newer security releases it found. */
const imageError = (ecosystem: "php" | "node", error: unknown): ProjectScan["checks"][number] =>
  error instanceof ImageMoveStopped && error.security_releases.length ? { ecosystem, error: error.message, security_releases: error.security_releases } : { ecosystem, error: message(error) };

/** `readers` and `client` exist for tests; callers use the registered readers and OSV. */
export async function scanProject(root: string, selected?: string, deps: { readers?: readonly ReadOnlyReader[]; client?: OsvClient } = {}): Promise<ProjectScan> {
  const readers = deps.readers ?? READONLY_READERS;
  const checks: ProjectScan["checks"] = [];
  const saved = existsSync(join(root, CONFIG)) ? readConfig(root) : undefined;
  const imageFile = saved && "dockerfile" in saved ? saved.dockerfile : "Dockerfile";
  const auto = !selected || selected === "auto", readOnly = isReadOnlyCliName(selected) ? READONLY_CLI_NAMES[selected] : undefined;
  const detected = detectEcosystems(root), ecosystems = !auto ? selected === "php" || selected === "node" || readOnly ? [] : [selected as Ecosystem] : detected;
  const client = deps.client ?? new OsvClient();
  for (const ecosystem of ecosystems) {
    if (!["npm", "composer", "maven"].includes(ecosystem)) throw new Error("Supported ecosystems: php, node, npm, composer, auto; scan only: maven, python, go, rust.");
    try {
      let installed = inventory(root, ecosystem);
      const originals = installed.files.map(f => [f, textFile(root, f)] as const);
      if (ecosystem === "maven") {
        const config = existsSync(join(root, CONFIG)) ? readConfig(root) : undefined;
        const image = config && "ecosystem" in config && config.ecosystem === "maven" ? config.image : undefined;
        installed = await resolvedMavenInventory(root, image);
      }
      const result = await client.scan(installed);
      if (originals.some(([file, original]) => textFile(root, file) !== original)) throw new Error("Dependency files changed during the scan.");
      checks.push({ ecosystem, result });
    } catch (error) { checks.push({ ecosystem, error: message(error) }); }
  }
  // Read-only ecosystems: findings only, never a plan. Each present file is reported by its reader's check.
  const handled = new Set<string>();
  for (const reader of readers) {
    if (!auto && reader.ecosystem !== readOnly?.ecosystem) continue;
    const present = reader.files.filter(f => existsSync(join(root, f)));
    if (!present.length) {
      if (readOnly) checks.push({ ecosystem: reader.ecosystem, error: `No ${selected} inventory found; expected ${reader.files.join(", ")} at the project root.` });
      continue;
    }
    for (const file of present) handled.add(file);
    try {
      // Read before the reader does, so a change while it reads is caught too.
      const originals = new Map(present.map(f => [f, textFile(root, f)]));
      const read = reader.read(root);
      if (!read) throw new Error(`${present.join(", ")} present, but the ${reader.ecosystem} reader returned no inventory.`);
      if (read.ecosystem !== reader.ecosystem) throw new Error(`The ${reader.ecosystem} reader returned a ${String(read.ecosystem)} inventory.`);
      for (const file of read.files) if (!originals.has(file)) originals.set(file, textFile(root, file));
      // Never dropped silently: a present file the reader neither read nor explained makes the result incomplete.
      const unread = present.filter(f => !read.files.includes(f) && !read.limitations.some(l => l.includes(f)));
      const installed = unread.length ? { ...read, limitations: [...read.limitations, ...unread.map(f => `${f} is present but was not read.`)] } : read;
      const result = await client.scanReadOnly(installed);
      if ([...originals].some(([file, original]) => textFile(root, file) !== original)) throw new Error("Dependency files changed during the scan.");
      checks.push({ ecosystem: reader.ecosystem, result });
    } catch (error) { checks.push({ ecosystem: reader.ecosystem, error: message(error) }); }
  }
  if (readOnly && !readers.some(r => r.ecosystem === readOnly.ecosystem)) {
    const present = readOnly.files.filter(f => existsSync(join(root, f)));
    checks.push({ ecosystem: readOnly.ecosystem, error: present.length ? `${present.join(", ")} present, but this build has no ${selected} reader; not checked.` : `No ${selected} inventory found, and this build has no ${selected} reader.` });
  }
  if (selected === "php" || (auto && existsSync(join(root, imageFile)) && /\bphp:/.test(textFile(root, imageFile)))) {
    try {
      checks.push({ ecosystem: "php", result: await scanPhp(textFile(root, imageFile)) });
    } catch (error) { checks.push(imageError("php", error)); }
  }
  // The official Node.js image (node.ts): when the policy or --ecosystem says node, or, unselected, a FROM line names it.
  if (selected === "node" || (auto && saved && "dockerfile" in saved && saved.ecosystem === "node") || (auto && existsSync(join(root, imageFile)) && namesNodeImage(textFile(root, imageFile)))) {
    try {
      checks.push({ ecosystem: "node", result: await scanNode(textFile(root, imageFile)) });
    } catch (error) { checks.push(imageError("node", error)); }
  }
  const unsupported = !auto ? [] : UNSUPPORTED.filter(f => existsSync(join(root, f)) && !handled.has(f));
  if (!checks.length && !unsupported.length) throw new Error(`No supported project inventory found. Expected PHP or Node.js Dockerfile, npm lockfile, composer.lock or pom.xml${readers.length ? `, or for a read-only scan ${readers.flatMap(r => r.files).join(", ")}` : ""}.`);
  const attention = unsupported.length > 0 || checks.some(c => "error" in c || ("findings" in c.result ? vulnerable(c.result) || c.result.status === "incomplete" : securityMove(c.result)));
  return { schema: 1, checked_at: new Date().toISOString(), status: attention ? "attention_required" : "no_known_updates", checks, unsupported };
}
