import { existsSync } from "node:fs";
import { join } from "node:path";
import { boundedText, canonicalJson, hashText } from "./bench-artifacts.ts";
import { snapshotProject } from "./project-snapshot.ts";

/** Freeze external prepared sources/instructions/lockfiles too, not only repository HEAD. */
export function preparedInputsHash(cache: string, libraries: Iterable<string>): string {
  const inputs: Record<string, unknown> = {};
  for (const library of [...new Set(libraries)].sort()) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(library)) throw new Error("Invalid prepared library.");
    const dir = join(cache, library);
    const auxiliary: Record<string, string> = {};
    // These hook/rule directories are not part of the prepared benchmark templates; do not inherit them.
    for (const name of [".claude", ".cursor", ".ludion"]) if (existsSync(join(dir, name))) throw new Error("Prepared benchmark cache contains assistant state; prepare a clean cache first.");
    for (const name of ["CLAUDE.md", "AGENTS.md", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
      if (existsSync(join(dir, name))) auxiliary[name] = hashText(boundedText(join(dir, name)));
    }
    inputs[library] = { sources: snapshotProject(dir), auxiliary };
  }
  return hashText(canonicalJson(inputs));
}
