// Bundles the CLI into one file, dist/cli.js, with its dependencies inlined: the published package has no
// runtime dependencies to install or audit.
import { build } from "esbuild";

await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.js",
  // Some bundled CommonJS dependencies call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __ludionRequire } from "node:module"; const require = __ludionRequire(import.meta.url);' },
  legalComments: "none",
});
console.log("Wrote dist/cli.js");