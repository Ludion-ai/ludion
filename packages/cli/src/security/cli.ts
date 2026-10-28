import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { patchProject } from "./patch.ts";
import { patchDependencies } from "./dependency-patch.ts";
import { detectEcosystems, DEFAULT_IMAGES, textFile, type Ecosystem } from "./inventory.ts";
import { scanProject } from "./scan.ts";
import { CONFIG, DEFAULT_CONFIG, readConfig, regularFile, rootPath } from "./project.ts";
import type { ReadOnlyScan } from "./osv.ts";
import { isReadOnlyCliName, readOnlyRefusal } from "./readonly/index.ts";

/** The text lines for one read-only check, in the form of the other dependency checks. */
export function readOnlyText(ecosystem: string, result: ReadOnlyScan): string[] {
  // Limitations can quote project files: no control characters reach the terminal.
  const plain = (text: string) => String(text).replace(/[\x00-\x1f\x7f]/g, " ");
  return [
    `${ecosystem}: ${result.inventory.packages.length} package versions · ${result.findings.length} advisory matches · ${result.status}`,
    ...result.findings.map(f => `  ${f.package.name}@${f.package.version} · ${f.advisory.id} · ${f.advisory.summary} · ${f.fixed_versions.length ? `OSV lists fixed: ${f.fixed_versions.join(", ")}` : "OSV lists no fixed version"}`),
    ...result.inventory.limitations.map(limit => `  Incomplete: ${plain(limit)}`),
    `  Scope: ${plain(result.inventory.scope)} (${result.inventory.files.map(plain).join(", ")})`,
    "  Read-only: Ludion reports known advisories for this ecosystem but does not plan or apply updates.",
  ];
}

export async function securityCli(command: string, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { dir: { type: "string", default: "." }, ecosystem: { type: "string" }, json: { type: "boolean" }, apply: { type: "boolean" }, interval: { type: "string", default: "900" } } });
  if (values.apply && !["patch", "watch"].includes(command)) throw new Error("--apply is only valid with patch or watch.");
  if (isReadOnlyCliName(values.ecosystem) && command !== "scan") throw new Error(readOnlyRefusal(values.ecosystem));
  if (values.ecosystem && !["init", "scan"].includes(command)) throw new Error("--ecosystem selects init/scan only; patch/watch use the saved project policy.");
  if (values.ecosystem && !["auto", "php", "npm", "composer", "maven"].includes(values.ecosystem) && !isReadOnlyCliName(values.ecosystem)) throw new Error("Supported ecosystems: php, npm, composer, maven, python, go, rust (scan only), auto.");
  const root = rootPath(values.dir!);
  if (command === "init") {
    if (existsSync(join(root, CONFIG))) throw new Error(`${CONFIG} already exists. Edit it to choose your real validation command.`);
    const choices: string[] = detectEcosystems(root);
    if (existsSync(join(root, "Dockerfile")) && /\bphp:/.test(textFile(root, "Dockerfile"))) choices.push("php");
    const selected = values.ecosystem && values.ecosystem !== "auto" ? values.ecosystem : choices.length === 1 ? choices[0]! : undefined;
    if (!selected) throw new Error("Choose the update policy with --ecosystem php|npm|composer|maven. A multi-ecosystem project can be scanned together; each patch policy chooses its dependency manager.");
    let config: unknown = DEFAULT_CONFIG;
    if (selected === "php") regularFile(root, "Dockerfile");
    else {
      const ecosystem = selected as Ecosystem;
      config = { schema: 1, ecosystem, image: DEFAULT_IMAGES[ecosystem], test: ecosystem === "npm" ? ["npm", "test"] : ecosystem === "composer" ? ["php", "tests/smoke.php"] : ["mvn", "--offline", "--batch-mode", "-Dmaven.repo.local=/opt/ludion-m2", "-DfailIfNoTests=true", "verify"], timeout_seconds: 120 };
    }
    writeFileSync(join(root, CONFIG), `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
    console.log(`Created ${CONFIG} (${selected}). Choose the tool image matching your application and its real offline test command before patching. No update was applied.`);
    return 0;
  }
  if (command === "scan") {
    const report = await scanProject(root, values.ecosystem);
    const only = report.checks.length === 1 ? report.checks[0] : undefined;
    if (values.json) console.log(JSON.stringify(only && only.ecosystem === "php" && "result" in only && !report.unsupported.length ? only.result : report, null, 2));
    else {
      for (const check of report.checks) {
        if ("error" in check) { console.error(`${check.ecosystem}: unavailable — ${check.error}`); continue; }
        if ("fixed_versions_note" in check.result) for (const line of readOnlyText(check.ecosystem, check.result)) console.log(line);
        else if ("findings" in check.result) {
          console.log(`${check.ecosystem}: ${check.result.inventory.packages.length} package versions · ${check.result.findings.length} advisory matches · ${check.result.status}`);
          for (const finding of check.result.findings) console.log(`  ${finding.package.name}@${finding.package.version} · ${finding.advisory.id} · ${finding.advisory.summary}`);
          for (const limit of check.result.inventory.limitations) console.log(`  Incomplete: ${limit}`);
          console.log(`  Scope: ${check.result.inventory.scope}`);
        } else console.log(`php: ${check.result.current.version} · ${check.result.candidate ? `update ${check.result.candidate.version}` : "no newer security release found"}`);
      }
      if (report.unsupported.length) console.error(`Unsupported inventories: ${report.unsupported.join(", ")}. These have not been checked.`);
      console.log("Known data only; no match is not a security guarantee. Dependency coordinates are sent to OSV; source stays local to your Docker setup.");
    }
    const vulnerable = report.checks.some(c => "result" in c && ("findings" in c.result ? c.result.findings.length > 0 : c.result.candidate !== null));
    return vulnerable ? 1 : report.status === "attention_required" ? 2 : 0;
  }
  async function patch(signal?: AbortSignal): Promise<number> {
    const config = readConfig(root);
    const result = "dockerfile" in config ? await patchProject(root, !!values.apply, { signal }) : await patchDependencies(root, !!values.apply, { signal });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else if (result.receipt) console.log(`Result: ${result.receipt.outcome}${result.receipt.reason ? ` — ${result.receipt.reason}` : ""}\nReceipt: ${result.path}\nSource update only. Production deployment was not changed.`);
    else console.log(`Result: ${result.scan.status}. No source update applied. No match is not a security guarantee.`);
    return result.receipt?.outcome === "failed" || result.scan.status === "incomplete" ? 2 : 0;
  }
  if (command === "patch") return patch();
  if (command !== "watch") throw new Error("Unknown security command.");
  const interval = Number(values.interval);
  if (!Number.isInteger(interval) || interval < 60 || interval > 86_400) throw new Error("--interval must be an integer from 60 to 86400 seconds.");
  const abort = new AbortController(), stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    while (!abort.signal.aborted) {
      try { await patch(abort.signal); } catch (error) { console.error(`ludion: ${error instanceof Error ? error.message : String(error)}`); }
      await delay(interval * 1000, undefined, { signal: abort.signal }).catch(error => { if (!abort.signal.aborted) throw error; });
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  return 0;
}
