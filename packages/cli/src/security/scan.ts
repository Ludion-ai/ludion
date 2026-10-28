import { existsSync } from "node:fs";
import { join } from "node:path";
import { detectEcosystems, inventory, textFile, type Ecosystem } from "./inventory.ts";
import { resolvedMavenInventory } from "./dependency-patch.ts";
import { OsvClient, type DependencyScan } from "./osv.ts";
import { scanPhp, type Scan } from "./php.ts";
import { CONFIG, readConfig } from "./project.ts";

export type ProjectScan = { schema: 1; checked_at: string; status: "attention_required" | "no_known_updates"; checks: ({ ecosystem: "php"; result: Scan } | { ecosystem: Ecosystem; result: DependencyScan } | { ecosystem: string; error: string })[]; unsupported: string[] };
export async function scanProject(root: string, selected?: string): Promise<ProjectScan> {
  const checks: ProjectScan["checks"] = [];
  const saved = existsSync(join(root, CONFIG)) ? readConfig(root) : undefined;
  const phpFile = saved && "dockerfile" in saved ? saved.dockerfile : "Dockerfile";
  const detected = detectEcosystems(root), ecosystems = selected && selected !== "auto" ? selected === "php" ? [] : [selected as Ecosystem] : detected;
  const client = new OsvClient();
  for (const ecosystem of ecosystems) {
    if (!["npm", "composer", "maven"].includes(ecosystem)) throw new Error("Supported ecosystems: php, npm, composer, maven, auto.");
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
    } catch (error) { checks.push({ ecosystem, error: error instanceof Error ? error.message : String(error) }); }
  }
  if (selected === "php" || ((!selected || selected === "auto") && existsSync(join(root, phpFile)) && /\bphp:/.test(textFile(root, phpFile)))) {
    try {
      checks.push({ ecosystem: "php", result: await scanPhp(textFile(root, phpFile)) });
    } catch (error) { checks.push({ ecosystem: "php", error: error instanceof Error ? error.message : String(error) }); }
  }
  const unsupported = selected && selected !== "auto" ? [] : ["requirements.txt", "pyproject.toml", "go.mod", "Cargo.lock", "build.gradle", "build.gradle.kts"].filter(f => existsSync(join(root, f)));
  if (!checks.length && !unsupported.length) throw new Error("No supported project inventory found. Expected PHP Dockerfile, npm lockfile, composer.lock or pom.xml.");
  const attention = unsupported.length > 0 || checks.some(c => "error" in c || ("findings" in c.result ? c.result.findings.length > 0 || c.result.status === "incomplete" : c.result.candidate !== null));
  return { schema: 1, checked_at: new Date().toISOString(), status: attention ? "attention_required" : "no_known_updates", checks, unsupported };
}
