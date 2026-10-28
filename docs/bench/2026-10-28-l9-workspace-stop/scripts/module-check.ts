// Runs workspaceManifestChanges (packages/cli/src/security/workspace-manifests.ts) alone on a PR's files, as data.
// Not the re-judgement (task step 4): `ludion judge` does not call the module yet.
// Usage: node module-check.ts <dir with before/, after/ and files (one changed path per line)>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceDir, workspaceManifestChanges } from "../../../../packages/cli/src/security/workspace-manifests.ts";

const dir = process.argv[2]!;
const read = (side: string, file: string) => JSON.parse(readFileSync(join(dir, side, file), "utf8"));
const files = readFileSync(join(dir, "files"), "utf8").split("\n").filter(Boolean);
const root = { before: read("before", "package.json"), after: read("after", "package.json") };
const lock = { before: read("before", "package-lock.json").packages, after: read("after", "package-lock.json").packages };
const out = files.filter(f => !["package.json", "package-lock.json"].includes(f)).map(file => ({
  file,
  dir: workspaceDir(file),
  reasons: workspaceManifestChanges({ file, before: read("before", file), after: read("after", file), root, lock }),
}));
console.log(JSON.stringify({ files, workspace_manifests: out }, null, 2));
