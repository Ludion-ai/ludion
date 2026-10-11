// Prepares the bench projects: each template in tools/bench/projects/<library> copied to <cache>/<library> with its
// packages installed (install scripts off). Runs then copy a prepared project, so each one starts from the same files.
// Usage: node tools/bench/src/projects.ts <cache dir>
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const templates = fileURLToPath(new URL("../projects/", import.meta.url));

export function prepareProjects(cache: string): string[] {
  const done: string[] = [];
  for (const lib of readdirSync(templates)) {
    const dest = join(cache, lib);
    cpSync(join(templates, lib), dest, { recursive: true });
    if (!existsSync(join(dest, "node_modules"))) {
      const r = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dest, stdio: "inherit", shell: process.platform === "win32" });
      if (r.status !== 0) throw new Error(`npm install failed in ${dest}.`);
    }
    done.push(dest);
  }
  return done;
}

if (import.meta.main) {
  const cache = process.argv[2];
  if (!cache) {
    console.error("Usage: node tools/bench/src/projects.ts <cache dir>");
    process.exit(2);
  }
  console.log(prepareProjects(cache).join("\n"));
}