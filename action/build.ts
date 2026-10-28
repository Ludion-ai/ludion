// Bundles what action.yml's mode judge runs, for a release commit (docs/bench/dogfood/prepublish-checklist.md):
// action/dist/record.js, this repository's judge record (.github/judge/record.ts) with its imports inlined. It runs the
// CLI at packages/cli/dist/cli.js, which `npm run build -w ludion-ai` writes. Run from the repository root.
import { build } from "esbuild";

await build({
  entryPoints: [".github/judge/record.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "action/dist/record.js",
  // Some bundled CommonJS dependencies call require(); give the ESM bundle one (as packages/cli/build.ts does).
  banner: { js: 'import { createRequire as __ludionRequire } from "node:module"; const require = __ludionRequire(import.meta.url);' },
  legalComments: "none",
});
console.log("Wrote action/dist/record.js");
