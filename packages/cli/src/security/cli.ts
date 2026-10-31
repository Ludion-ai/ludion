import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { patchProject } from "./patch.ts";
import { patchDependencies } from "./dependency-patch.ts";
import { detectEcosystems, DEFAULT_IMAGES, textFile, type Ecosystem } from "./inventory.ts";
import { scanProject, securityMove, vulnerable } from "./scan.ts";
import { CONFIG, DEFAULT_CONFIG, DEFAULT_NODE_CONFIG, readConfig, regularFile, rootPath } from "./project.ts";
import { namesNodeImage } from "./node.ts";
import type { Scan } from "./php.ts";
import { useProject } from "../../../sandbox/src/docker.ts";
import type { ReadOnlyFinding, ReadOnlyScan } from "./osv.ts";
import { isReadOnlyCliName, READONLY_CLI_NAMES, readOnlyRefusal } from "./readonly/index.ts";

/** Read-only checks can quote project files (limitations, reader errors): no C0 or C1 control character reaches the terminal. */
const plain = (text: string) => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
const READONLY_ECOSYSTEMS: readonly string[] = Object.values(READONLY_CLI_NAMES).map(r => r.ecosystem);
/** An image check's text after its current version: a move with no newer security release says so, and where its wait is. */
const imageText = (result: Scan): string => !result.candidate ? "no newer security release found"
  : securityMove(result) ? `update ${result.candidate.version}`
  : `newest release ${result.candidate.version} of the line (no newer security release); ${result.status === "wait" ? "waits until" : "its wait ended"} ${result.wait_until}`;

/** The text lines for one read-only check, in the form of the other dependency checks. Informational findings come last. */
export function readOnlyText(ecosystem: string, result: ReadOnlyScan): string[] {
  const vulnerabilities = result.findings.filter(f => f.kind === "vulnerability");
  const notices = result.findings.filter((f): f is Extract<ReadOnlyFinding, { kind: "informational" }> => f.kind === "informational");
  const fixed = (f: ReadOnlyFinding) => f.fixed_versions.length ? `OSV lists fixed: ${f.fixed_versions.join(", ")}` : "OSV lists no fixed version";
  return [
    `${ecosystem}: ${result.inventory.packages.length} package versions · ${vulnerabilities.length} advisory matches${notices.length ? ` · ${notices.length} informational` : ""} · ${result.status}`,
    ...vulnerabilities.map(f => `  ${f.package.name}@${f.package.version} · ${f.advisory.id} · ${plain(f.advisory.summary)} · ${fixed(f)}`),
    ...notices.map(f => `  Informational (${f.informational}, not counted as a vulnerability): ${f.package.name}@${f.package.version} · ${f.advisory.id} · ${plain(f.advisory.summary)} · ${fixed(f)}`),
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
  if (values.ecosystem && !["auto", "php", "node", "npm", "composer", "maven"].includes(values.ecosystem) && !isReadOnlyCliName(values.ecosystem)) throw new Error("Supported ecosystems: php, node, npm, composer, maven, python, go, rust (scan only), auto.");
  const root = rootPath(values.dir!);
  // docker is never taken from a PATH folder inside the project (packages/sandbox/src/docker.ts, findDocker).
  useProject(root);
  if (command === "init") {
    if (existsSync(join(root, CONFIG))) throw new Error(`${CONFIG} already exists. Edit it to choose your real validation command.`);
    const choices: string[] = detectEcosystems(root);
    if (existsSync(join(root, "Dockerfile")) && /\bphp:/.test(textFile(root, "Dockerfile"))) choices.push("php");
    if (existsSync(join(root, "Dockerfile")) && namesNodeImage(textFile(root, "Dockerfile"))) choices.push("node");
    const selected = values.ecosystem && values.ecosystem !== "auto" ? values.ecosystem : choices.length === 1 ? choices[0]! : undefined;
    if (!selected) throw new Error("Choose the update policy with --ecosystem php|node|npm|composer|maven. A multi-ecosystem project can be scanned together; each patch policy chooses its dependency manager.");
    let config: unknown = selected === "node" ? DEFAULT_NODE_CONFIG : DEFAULT_CONFIG;
    if (selected === "php" || selected === "node") regularFile(root, "Dockerfile");
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
    if (values.json) console.log(JSON.stringify(only && (only.ecosystem === "php" || only.ecosystem === "node") && "result" in only && !report.unsupported.length ? only.result : report, null, 2));
    else {
      for (const check of report.checks) {
        if ("error" in check) { console.error(`${check.ecosystem}: unavailable — ${READONLY_ECOSYSTEMS.includes(check.ecosystem) ? plain(check.error) : check.error}`); continue; }
        if ("fixed_versions_note" in check.result) for (const line of readOnlyText(check.ecosystem, check.result)) console.log(line);
        else if ("findings" in check.result) {
          console.log(`${check.ecosystem}: ${check.result.inventory.packages.length} package versions · ${check.result.findings.length} advisory matches · ${check.result.status}`);
          for (const finding of check.result.findings) console.log(`  ${finding.package.name}@${finding.package.version} · ${finding.advisory.id} · ${finding.advisory.summary}`);
          for (const limit of check.result.inventory.limitations) console.log(`  Incomplete: ${limit}`);
          console.log(`  Scope: ${check.result.inventory.scope}`);
        } else console.log(`${check.ecosystem}: ${check.result.current.version} · ${imageText(check.result)}`);
      }
      if (report.unsupported.length) console.error(`Unsupported inventories: ${report.unsupported.join(", ")}. These have not been checked.`);
      console.log("Known data only; no match is not a security guarantee. Dependency coordinates are sent to OSV; source stays local to your Docker setup.");
    }
    const found = report.checks.some(c => "result" in c && ("findings" in c.result ? vulnerable(c.result) : securityMove(c.result)));
    return found ? 1 : report.status === "attention_required" ? 2 : 0;
  }
  async function patch(signal?: AbortSignal): Promise<number> {
    const config = readConfig(root);
    const result = "dockerfile" in config ? await patchProject(root, !!values.apply, { signal }) : await patchDependencies(root, !!values.apply, { signal });
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else if (result.receipt) {
      console.log(`Result: ${result.receipt.outcome}${result.receipt.reason ? ` — ${plain(result.receipt.reason)}` : ""}`);
      // Each fix is validated, and with --apply committed on its own branch, on its own; one failing stops no other.
      if ("fixes" in result.receipt) for (const fix of result.receipt.fixes) {
        console.log(`  ${fix.package} ${fix.changes.map(c => `${c.from} → ${c.to}`).join(", ")}: ${fix.outcome}${fix.branch ? ` (branch ${fix.branch})` : ""}${fix.reason ? ` — ${plain(fix.reason)}` : ""}`);
        // A fix stopped by a choice's publisher check has exactly this reason (dependency-patch.ts); that note is printed
        // once. Any other reason, or a text that drifts from it, prints the note again rather than leaving it out.
        for (const choice of fix.version_choice ?? []) {
          const line = [fix.reason === `Gate 2 stops this fix: ${choice.note}` ? "" : plain(choice.note), choice.skipped.length > 1 ? `Passed over: ${choice.skipped.map(s => `${s.version} (${plain(s.reason)})`).join(", ")}.` : ""].filter(Boolean).join(" ");
          if (line) console.log(`    ${line}`);
        }
      }
      else if (result.receipt.branch) console.log(`  Branch: ${result.receipt.branch}`);
      console.log(`Receipt: ${result.path}\nSource update only${values.apply ? ", on branches; the working tree was not changed" : ""}. Production deployment was not changed.`);
    }
    else console.log(`Result: ${result.scan.status}. No source update applied. No match is not a security guarantee.`);
    return result.receipt?.outcome === "failed" || result.receipt?.outcome === "partial" || result.scan.status === "incomplete" ? 2 : 0;
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
