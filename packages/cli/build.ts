// Bundles the CLI into one file, dist/cli.js, with its dependencies inlined: the published package has no
// runtime dependencies to install or audit.
import { chmodSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/cli.js",
  // Some bundled CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __ludionRequire } from "node:module"; const require = __ludionRequire(import.meta.url);' },
  legalComments: "none",
});
// npm pack takes each file's mode from the disk, so a checkout that marks files executable (a copy from Windows, say)
// packs a different tarball. The packed files are set to 0644, as a Linux checkout has them, so any build packs the
// same bytes (docs/decisions/2026-10-29-lp-rest-followups.md). npm makes the bin executable when it installs it.
for (const file of ["dist/cli.js", "LICENSE", "README.md", "package.json"]) chmodSync(file, 0o644);
console.log("Wrote dist/cli.js");
