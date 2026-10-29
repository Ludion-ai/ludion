# L1d step 1: the 69 misses, by cause, one row per package (2026-10-29)

The misses to fix are the 58 of L1c's new 100 (docs/bench/2026-10-29-l1c/review, `review-tally.json` → `new.missed`) and the 11 of the original 100 (the noise rerun's verdicts, docs/bench/2026-10-28-noise-v2/review, which L1c kept). The verdicts are the reviewers'. The worker assigned only the cause, from the reviewer's own evidence and the lockfile and source facts it cites. `scripts/classify.mjs` builds `classification.json` (each row with the reviewer's full evidence) and `classification-table.md` (all 69 rows: package, verdict, cause, basis). It reads committed files only and ran in Docker.

| Cause | Misses | Repositories (packages) |
| --- | --- | --- |
| **A.** The source came from GitHub's archive, which leaves out `export-ignore` files. The split read the partial tree as complete and used D2 | **44** | eighteen73/pulsar-extensions (44) |
| **B1.** A build command runs webpack's bin. The bin hands off to webpack-cli, which webpack names only in `peerDependenciesMeta`. webpack-cli's declared dependencies and peers reach the copy | **8** | STRML/strml.net (body-parser, launch-editor, qs, shell-quote), ccnmtl/specialneedsvisit-pack (body-parser, qs), carlostighe/modalMap (cross-spawn, loader-utils) |
| **B2.** `webpack serve` runs webpack's bin, then webpack-cli, then webpack-dev-server, each named only in the previous package's `peerDependenciesMeta`. webpack-dev-server's dependencies reach the copy | **6** | timmson/agile-impact-map (body-parser, qs), opencast/studio (body-parser, qs, uuid, webpack-dev-middleware) |
| **B3.** webpack-cli reads `webpack.config.ts` through a TypeScript register hook (interpret/rechoir picks ts-node, which is installed). ts-node's dependencies reach the copy | **1** | opencast/studio (diff) |
| **C1.** A `require()` whose argument is not a literal but holds one: `require(process.env.SHARP_PATH \|\| 'sharp')` | **1** | acekyd/acekyd (sharp) |
| **C2.** A `require.resolve()` of a constant that holds a literal: `const UPSTREAM = 'shadcn/tailwind.css'` … `require.resolve(UPSTREAM)` | **6** | BilLogic/uno-blueprint (body-parser, deepmerge, fast-uri, hono, ip-address, qs) |
| **C3.** A node_modules path built from literal segments: `join('node_modules', '@vscode', 'vsce', 'vsce')` | **2** | ASIL-E-Hatake/vscode-games (@azure/msal-node, qs) |
| **D.** A build tool's configuration that P2's file list does not name: Umi's `config/config.ts` names `@umijs/max-plugin-openapi` | **1** | stop-bullshit/luckyh-cloud-web (mockjs) |
| **Total** | **69** | 58 in the new 100 (6 repositories), 11 in the original 100 (4 repositories) |

## What each cause is, from the evidence

- **A (44).** eighteen73/pulsar-extensions' `.gitattributes` at f2aad049 export-ignores `/src`, `/package.json`, `/package-lock.json`, `/webpack.config.js`, `/postcss.config.js` and `/.*`. GitHub's archive of the commit has 27 files and none of these. The measurement read package.json and package-lock.json from raw.githubusercontent.com, but it handed the split the archive as the source tree. The split saw no `start` or `build` script, so D2 left out everything that `wp-scripts` (P5 `start`, P6 `build`) reaches. One miss per vulnerable name on those paths. Every path is in `classification-table.md`, rows 8–51.
- **B (15).** The lockfiles show the hand-offs (read in Docker from the L1c sources volume):
  - webpack 5.105–5.112 has `peerDependenciesMeta: { "webpack-cli": { optional: true } }` and no `peerDependencies`;
  - webpack-cli 7.2.x names webpack-dev-server in `peerDependencies`;
  - webpack-cli 4.9.2 and 6.0.1, and @webpack-cli/serve 1.6.1 and 3.0.1, name it only in `peerDependenciesMeta`.

  Section 2's following takes `peerDependencies`, so a name that is only in `peerDependenciesMeta` is not followed. And P5/P6 match a command's words to bin names, so `webpack` matches only webpack's own bin. The reviewers read P5/P6's "what these commands run" as including what the bin hands off to: "yes" for carlostighe and opencast (start), "undecidable" for the others. For opencast's `diff` (B3), ts-node is in no field of webpack-cli or webpack. webpack-cli loads `webpack.config.ts` through `interpret`/`rechoir` (its dependencies), and those pick the installed ts-node at run time.
- **C (9).** Each file is section 2 source (under `scripts/`, not a test). `callSpecifiers` reads only a quoted literal right after `require(`, `import(` and `require.resolve(`, and `nodeModulesPaths` matches only the literal text `node_modules/<name>`. So:
  - `require(process.env.SHARP_PATH || 'sharp')` names nothing;
  - `require.resolve(UPSTREAM)` names nothing;
  - `join('node_modules', '@vscode', 'vsce', 'vsce')` names nothing.
- **D (1).** Umi reads `config/config.ts` (or `.umirc.ts`) for `max build`, which the `build` script and the Dockerfile's build stage run. P2's list does not name either file, so its quoted plugin names are not read. The file is still source, so its imports are read, but the plugin is a string, not an import.

## What the fixes will do (step 2)

Each fix only makes more copies production, under the principle "when in doubt, production". None changes the count gate, the miss gate, the wait table, section 2's D1 lists, or any rule that makes a copy dev-only. The decision entry is docs/decisions/2026-10-29-l1d-fix.md, committed with the code.
- A: the split treats a source tree that lacks the package.json of a lockfile project folder as incomplete (D1 only). The measurement also treats an archive as incomplete when any `.gitattributes` it can see (the root one from raw.githubusercontent.com at the SHA, and every one in the archive) has an `export-ignore` attribute.
- B1/B2: a command that runs a package also runs the installed copies that package resolves for the names in its `peerDependenciesMeta`, recursively. B3: a TypeScript build configuration (`webpack.config.ts` and the rest of P2's files ending `.ts`, `.cts` or `.mts`) makes production the TypeScript register hooks that `interpret` lists, as resolved from that file's folder, when `interpret` or `rechoir` is installed.
- C1/C2: a `require()`, `import()` or `require.resolve()` whose argument is not a literal names every literal string in the argument, and the literal that a `const`/`let`/`var` in the same file assigns to an identifier argument. C3: literal segments joined after a literal `node_modules` count as a node_modules path.
- D: Umi's `.umirc.*` and `config/config.*` are read as a build tool's configuration (P2).
