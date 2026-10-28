import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectEcosystems, inventory, textFile, type Ecosystem } from "./inventory.ts";
import { resolvedMavenInventory } from "./dependency-patch.ts";
import { OsvClient, type DependencyScan, type ReadOnlyScan } from "./osv.ts";
import { scanPhp, type Scan } from "./php.ts";
import { CONFIG, readConfig } from "./project.ts";
import { COVERED_BY, isReadOnlyCliName, READONLY_CLI_NAMES, READONLY_READERS, type ReadOnlyReader } from "./readonly/index.ts";
import type { ReadOnlyEcosystem } from "./readonly/types.ts";

export type ProjectScan = { schema: 1; checked_at: string; status: "attention_required" | "no_known_updates"; checks: ({ ecosystem: "php"; result: Scan } | { ecosystem: Ecosystem; result: DependencyScan } | { ecosystem: ReadOnlyEcosystem; result: ReadOnlyScan } | { ecosystem: string; error: string })[]; unsupported: string[] };
/** Inventories scan does not read. A file a registered read-only reader handled is left out. */
const UNSUPPORTED = ["requirements.txt", "pyproject.toml", "go.mod", "Cargo.lock", "build.gradle", "build.gradle.kts"];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
/** A known vulnerability: any finding of a dependency scan; a read-only scan's informational findings do not count. */
export const vulnerable = (result: DependencyScan | ReadOnlyScan): boolean => "fixed_versions_note" in result ? result.findings.some(f => f.kind === "vulnerability") : result.findings.length > 0;

/** `readers` and `client` exist for tests; callers use the registered readers and OSV. */
export async function scanProject(root: string, selected?: string, deps: { readers?: readonly ReadOnlyReader[]; client?: OsvClient } = {}): Promise<ProjectScan> {
  const readers = deps.readers ?? READONLY_READERS;
  const checks: ProjectScan["checks"] = [];
  const saved = existsSync(join(root, CONFIG)) ? readConfig(root) : undefined;
  const phpFile = saved && "dockerfile" in saved ? saved.dockerfile : "Dockerfile";
  const auto = !selected || selected === "auto", readOnly = isReadOnlyCliName(selected) ? READONLY_CLI_NAMES[selected] : undefined;
  const detected = detectEcosystems(root), ecosystems = !auto ? selected === "php" || readOnly ? [] : [selected as Ecosystem] : detected;
  const client = deps.client ?? new OsvClient();
  for (const ecosystem of ecosystems) {
    if (!["npm", "composer", "maven"].includes(ecosystem)) throw new Error("Supported ecosystems: php, npm, composer, maven, python, go, rust (scan only), auto.");
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
      // Never dropped silently: a present file the reader neither read, nor covered by a lock it read, nor explained
      // makes the result incomplete.
      const unread = present.filter(f => !read.files.includes(f) && !(COVERED_BY[f] ?? []).some(lock => read.files.includes(lock)) && !read.limitations.some(l => l.includes(f)));
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
  if (selected === "php" || (auto && existsSync(join(root, phpFile)) && /\bphp:/.test(textFile(root, phpFile)))) {
    try {
      checks.push({ ecosystem: "php", result: await scanPhp(textFile(root, phpFile)) });
    } catch (error) { checks.push({ ecosystem: "php", error: message(error) }); }
  }
  const unsupported = !auto ? [] : UNSUPPORTED.filter(f => existsSync(join(root, f)) && !handled.has(f));
  if (!checks.length && !unsupported.length) throw new Error(`No supported project inventory found. Expected PHP Dockerfile, npm lockfile, composer.lock or pom.xml${readers.length ? `, or for a read-only scan ${readers.flatMap(r => r.files).join(", ")}` : ""}.`);
  const attention = unsupported.length > 0 || checks.some(c => "error" in c || ("findings" in c.result ? vulnerable(c.result) || c.result.status === "incomplete" : c.result.candidate !== null));
  return { schema: 1, checked_at: new Date().toISOString(), status: attention ? "attention_required" : "no_known_updates", checks, unsupported };
}
