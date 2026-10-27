import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { patchProject } from "./patch.ts";
import { scanPhp, type Scan } from "./php.ts";
import { CONFIG, DEFAULT_CONFIG, readConfig, regularFile, rootPath } from "./project.ts";

function show(scan: Scan, json: boolean): void {
  if (json) { console.log(JSON.stringify(scan, null, 2)); return; }
  console.log(`PHP ${scan.current.version} · ${scan.current.reference}`);
  console.log(scan.candidate ? `Security update available: ${scan.candidate.reference}` : "No newer PHP security release found in this branch.");
  console.log(`Source: ${scan.source}\n${scan.note}`);
}

export async function securityCli(command: string, args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { dir: { type: "string", default: "." }, json: { type: "boolean" }, apply: { type: "boolean" }, interval: { type: "string", default: "900" } } });
  if (values.apply && !["patch", "watch"].includes(command)) throw new Error("--apply is only valid with patch or watch.");
  const root = rootPath(values.dir!);
  if (command === "init") {
    if (existsSync(join(root, CONFIG))) throw new Error(`${CONFIG} already exists. Edit it to choose your real validation command.`);
    regularFile(root, "Dockerfile");
    writeFileSync(join(root, CONFIG), `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: "wx" });
    console.log(`Created ${CONFIG}. Replace test with your application's real smoke-test argv before patching. Nothing was updated.`);
    return 0;
  }
  if (command === "scan") {
    const path = existsSync(join(root, CONFIG)) ? readConfig(root).dockerfile : "Dockerfile";
    const scan = await scanPhp(readFileSync(regularFile(root, path), "utf8"));
    show(scan, !!values.json);
    return scan.candidate ? 1 : 0;
  }
  async function patch(): Promise<number> {
    const result = await patchProject(root, !!values.apply);
    if (values.json) console.log(JSON.stringify(result, null, 2));
    else {
      show(result.scan, false);
      if (result.receipt) console.log(`Result: ${result.receipt.outcome}${result.receipt.reason ? ` — ${result.receipt.reason}` : ""}\nReceipt: ${result.path}\nProduction deployment was not changed.`);
    }
    return result.receipt?.outcome === "failed" ? 2 : 0;
  }
  if (command === "patch") return patch();
  if (command !== "watch") throw new Error("Unknown security command.");
  const interval = Number(values.interval);
  if (!Number.isInteger(interval) || interval < 60 || interval > 86_400) throw new Error("--interval must be an integer from 60 to 86400 seconds.");
  // Foreground process, no hidden service or system scheduler. Each cycle refetches official metadata.
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    while (!abort.signal.aborted) {
      try { await patch(); } catch (err) { console.error(`ludion: ${err instanceof Error ? err.message : String(err)}`); }
      await delay(interval * 1000, undefined, { signal: abort.signal }).catch(err => { if (!abort.signal.aborted) throw err; });
    }
  } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  return 0;
}
