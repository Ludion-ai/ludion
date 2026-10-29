## 2026-10-28 (cycle 3) — Gate 1's production/dev split, rebuilt; the noise rerun's definitions, fixed before running it

The noise measurement (docs/bench/2026-10-28-noise) found 167 misses among packages that the lockfile's `dev` flag left out, and its reviewers read (b), (c), (d) and CSS imports differently. The owner's wording below replaces the split. This entry is committed and pushed before the split is implemented and before the rerun. A later change is a new entry with a new run. The count gate, the miss gate, the wait table and the backtest gates are unchanged.

**1. The rule (the owner's wording).**
- **Principle.** Leave out only what can be shown dev-only. When in doubt, a package is production.
- **May be dev-only.** Test runners, linters, formatters and type definitions (`@types`). Besides those, what the source does not import and what enters neither the build output nor the production image.
- **Production.** What the source reaches when the project has a bundler configuration or a build script, following declared dependencies. Bundler helper libraries. Runtimes shipped with the app, such as Electron. What the `start` script or a Dockerfile's production stage uses. CSS imports.

**2. How it is read.** One reading for each part; this settles the first run's (b), (c), (d) and CSS.
- **Unit.** An installed copy (a lockfile install path). A version is dev-only only when every installed copy of it is dev-only, as before. Only a copy the lockfile marks `dev` can be dev-only.
- **Following.** From every production copy, every copy its declared `dependencies`, `optionalDependencies` and `peerDependencies` resolve to (Node's nearest `node_modules` from that copy's path) is production too, whatever those packages do at run time.
- **The source.** Every file of the repository outside `node_modules` and `.git` that is code (`js`, `jsx`, `ts`, `tsx`, `mjs`, `cjs`, `mts`, `cts`, `vue`, `svelte`, `astro`, `mdx`, `marko`), a stylesheet (`css`, `scss`, `sass`, `less`, `styl`, `stylus`, `pcss`, `postcss`) or markup (`html`, `htm`, `ejs`, `hbs`, `handlebars`, `pug`, `njk`, `liquid`). Not the source:
  - tests: files under a folder named `test`, `tests`, `__tests__`, `__mocks__`, `__snapshots__`, `__fixtures__`, `e2e`, `cypress`, `playwright`, `spec` or `specs`, and files named `*.test.*`, `*.spec.*`, `*.e2e.*`, `*.cy.*`, or `setupTests`, `setup-tests`, `test-setup`, `jest.setup` or `vitest.setup` with any extension;
  - the configuration of test runners, linters, formatters and commit hooks: `.config`, `.conf` and `.workspace` files of `jest`, `vitest`, `playwright`, `cypress`, `karma`, `ava`, `wdio`, `nightwatch`, `mocha`, `tap`, `eslint`, `prettier`, `stylelint`, `commitlint` and `lint-staged`; `.eslintrc*`, `.prettierrc*`, `.stylelintrc*`, `.lintstagedrc*`, `.commitlintrc*`, `.mocharc*`; files under `.husky/`;
  - type declarations (`*.d.ts`, `*.d.mts`, `*.d.cts`).

  Build configuration, build scripts, stories, examples and every other such file are source.
- **An import.** `import` or `export … from`, `import()`, `require()`, `require.resolve()`; a stylesheet's `@import`, `@use`, `@forward`, `@plugin`, `@reference` and `url(~…)`; a `@jsxImportSource x` pragma; a `node_modules/<package>` path in a source file, a build tool's configuration or a package.json script. `import type` and `export type` are not imports. A bare specifier names a package by its first segment (`@scope/name` by two). Relative, absolute, URL, builtin and alias specifiers (`@/`, `~/`, `#`, `$`) name none. The copy imported is the nearest `node_modules` up the file's path, else every installed copy of that name.

A copy is **production** when any of these holds, and so is everything the following above reaches from it:
- **P0, the lockfile.** The lockfile does not mark it `dev`.
- **P1, the source.** The source imports it. This settles **(b)**: a package reached only through build-time paths is production when the source reaches it, and build configuration and build scripts are source. It settles **CSS**: a stylesheet import is an import, CSS-only or not, and is followed like any other.
- **P2, a build tool's configuration names it.** The files:
  - `<tool>.config.*` or `<tool>.conf.*` for `vite`, `webpack`, `rollup`, `rspack`, `rsbuild`, `rolldown`, `esbuild`, `tsup`, `tsdown`, `build`, `next`, `nuxt`, `astro`, `svelte`, `remix`, `react-router`, `quasar`, `vue`, `babel`, `postcss`, `tailwind`, `uno`, `unocss`, `craco`, `metro`, `app`, `electron.vite`, `electron-builder`, `forge`, `capacitor`, `docusaurus`, `snowpack`, `wmr`, `parcel`, `gatsby` and `vinxi`;
  - `webpack.*.js` and `webpack.*.ts`; `gatsby-config`, `gatsby-node`, `gatsby-browser`, `gatsby-ssr`, `ember-cli-build`, `gulpfile` and `gruntfile`;
  - `angular.json`, `project.json`, `nx.json`, `turbo.json`, `electron-builder.json` and `.yml`; `.babelrc*`, `.postcssrc*`, `.swcrc`, `.parcelrc`; files in `.storybook/`;
  - package.json's `babel` and `postcss` fields, and `jsxImportSource` in `tsconfig*.json` or `jsconfig*.json`.

  Named means a quoted string whose package part is an installed package's name, with Babel's short names spelled out (`preset-env` as `@babel/preset-env` and `babel-preset-env`, and so on), and in PostCSS configuration also an object key. This settles **(c)**, with P3 and P6: what a build tool's configuration names or the build runs is production. Showing in the tool's code that its code reaches the output is not needed.
- **P3, bundler helper libraries.** The copy each project folder (the root, every workspace folder) resolves for `tslib`, `@babel/runtime`, `@babel/runtime-corejs2`, `@babel/runtime-corejs3`, `@babel/helpers`, `babel-runtime`, `core-js`, `core-js-pure`, `core-js-bundle`, `regenerator-runtime`, `@swc/helpers`, `@swc/core`, `typescript`, `esbuild`, `vite`, `rollup`, `webpack`, `@rspack/core`, `rolldown`, `parcel`, `browserify`, `systemjs` and `@vercel/ncc`. The bundlers and transpilers are in the list because they put their own helpers into the output.
- **P4, shipped runtimes.** Every copy of `electron`, `electron-nightly`, `electron-prebuilt`, `electron-prebuilt-compile` and `nw`.
- **P5, production commands.** What these commands run, by a package's `bin` name, or by its name as the first word, after a runner (`npx`, `npm exec`, …) or after `-r`, `--require`, `--import` or `--loader`:
  - the `prestart`, `start` and `poststart` scripts of every package.json outside `node_modules`;
  - every `RUN`, `CMD` and `ENTRYPOINT` of a production Dockerfile's final stage and of the stages it is built `FROM`;
  - a `Procfile`, and the commands in `docker-compose*.yml`, `compose*.yml`, `app.yaml`, `render.yaml`, `railway.json` or `.toml`, `fly.toml`, `nixpacks.toml`, `ecosystem.config.*` and `ecosystem.json`.

  The scripts they call are followed (`npm run x`, `yarn x`, `pnpm x`, `bun run x`, `run-s`, `run-p`, `npm-run-all`, `concurrently`, `turbo`, `nx`, `lerna`). This settles **(d)**: a `start` script counts whatever it runs, a development server included.
- **P6, build commands.** What the build runs, read as in P5:
  - the `build`, `generate` and `export` scripts, the scripts named `build:*`, `generate:*` and `export:*`, and their `pre` and `post` scripts, in every package.json outside `node_modules`;
  - `buildCommand` in `vercel.json` and `command` in `netlify.toml`;
  - the `RUN` commands of the Dockerfile stages that a production stage is built `FROM` or copies `--from`.

  Test runners, linters and formatters that a build command runs are not made production by P6. P0 to P5 still apply to them.

**Production Dockerfiles.** A Dockerfile is any `Dockerfile*`, `*.Dockerfile` or `Containerfile*` with a `FROM` line. It is a production Dockerfile unless it is under `.devcontainer/` or its name marks it `dev`, `development`, `test`, `tests`, `ci` or `e2e` (`Dockerfile.dev`, `dev.Dockerfile`, …). Its final stage **holds devDependencies** when, after its `FROM` chain, any of these holds:
- an `npm ci`, `npm install`, `yarn`, `pnpm install` or `bun install` that is not global runs without `--omit=dev`, `--production`, `--only=prod`, `--prod` or `-P`, with `NODE_ENV` not `production`, and no later `npm prune --omit=dev` or `--production`, `pnpm prune --prod` or `yarn workspaces focus --production` removes them;
- it copies `node_modules`, or a stage's whole working folder, from a stage that holds them;
- it copies the build context's root (`.` or `./`), and no `.dockerignore` in the Dockerfile's folder or the repository root ignores `node_modules`.

A dev-marked copy that no P-rule makes production is **dev-only** when either holds:
- **D1, a test runner, linter, formatter or `@types` package.** It is one, declared in a project folder's `devDependencies`, or every path to it from the project folders' declared dependencies passes through one. The lists:
  - test runners: `jest`, `jest-*`, `@jest/*`, `ts-jest`, `babel-jest`, `@swc/jest`, `vitest`, `@vitest/*`, `mocha`, `ava`, `@ava/*`, `jasmine`, `jasmine-*`, `karma`, `karma-*`, `tap`, `tape`, `uvu`, `@playwright/test`, `playwright`, `playwright-core`, `cypress`, `@cypress/*`, `testcafe`, `webdriverio`, `@wdio/*`, `nightwatch`, `@web/test-runner*`, `@storybook/test-runner`;
  - linters: `eslint`, `eslint-*`, `@eslint/*`, `@eslint-community/*`, `@typescript-eslint/*`, `typescript-eslint`, `vue-eslint-parser`, `@angular-eslint/*`, `@<scope>/eslint-plugin*`, `@<scope>/eslint-config*`, `@<scope>/eslint-parser*`, `stylelint`, `stylelint-*`, `@stylistic/*`, `tslint`, `tslint-*`, `oxlint`, `@oxlint/*`, `xo`, `standard`, `jshint`, `markdownlint`, `markdownlint-cli`, `markdownlint-cli2`, `commitlint`, `@commitlint/*`, `htmlhint`, `@biomejs/*`;
  - formatters: `prettier`, `prettier-plugin-*`, `@prettier/*`, `@<scope>/prettier-plugin*`, `@<scope>/prettier-config*`, `dprint`, `@dprint/*`;
  - type definitions: `@types/*`.
- **D2, shown unused in production.** The source tree was read, and no production Dockerfile's final stage holds devDependencies. Then a copy that no P-rule makes production is shown dev-only: the source does not import it, the build output does not take it (P2, P3, P6), and the production image does not hold it.

Without the source tree, or when a production Dockerfile's final stage holds devDependencies, only D1 can show a copy dev-only. Every project folder's declared dependency that is not a D1 package is then production, and so is every copy that no project folder's declared dependency reaches, with everything they reach.

**3. In the judge.** `ludion judge --source <dir>` reads the project's files at the judged commit as text. It never runs them and follows no symbolic link. Without `--source`, only D1 applies. judge.yml passes no `--source` and is not changed here (it is a protected path), so on this repository's own PRs only D1 applies. The comment says which split was used.

The lockfile reader's refusal is fixed narrowly. npm records an installed package's own workspace folders as `extraneous` entries at paths that are not install paths (`node_modules/primitives/packages/ai-gateway` in JakeWharton/jakewharton.com). Node never loads a package from such a path, and npm does not install it. Such an entry is skipped when it is `extraneous`, has no `resolved`, `integrity` or `link`, and has no `.` or `..` segment. Every other key that is not an install path is still refused. In `ludion judge`, a skipped entry that is added, removed or changed stops at gate 4.

**4. The rerun.**
- **The sample.** The same 100 repositories at the same recorded SHAs, in the same order, as `rows` in docs/bench/2026-10-28-noise/noise.json (3105fac). No new search, and inclusion is not decided again. JakeWharton/jakewharton.com is measured beside the sample, not in it.
- **The two counts,** as registered for the first run (its section 2), recomputed now: npm audit 11.19.1 in the same image, with its `--omit=dev` count and its direct findings, and the judge's OSV lookup (`osvIds`). package.json and package-lock.json come from raw.githubusercontent.com at the recorded SHA. The judge's count is the number of distinct package names with at least one production version (section 2) named by an OSV record.
- **The source tree.** Each repository at its recorded SHA comes from GitHub's archive of that commit (codeload), with `node_modules` folders left out. It is extracted in Docker into a volume before the run, and never run. Its SHA-256 and file count are recorded. If an archive cannot be fetched or extracted after three attempts, that repository's split is computed without the source (D1 only), as the judge would compute it, and this is reported.
- **How it runs.**
  - In Docker: node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205, a read-only root, a non-root user, no forwarded environment, the sources read-only.
  - Three attempts per repository for network errors.
  - The script is `docs/bench/2026-10-28-noise-v2/scripts/rerun.ts`. It records in `run.log` the commit, the git blob hashes of the files that compute the counts, and every printed line. It never overwrites a result.
  - The first execution started at the registered commit is the result. A stopped one is reported with its log, and the next execution is the result.
- **Shown, not gated:**
  - the first run's numbers beside the rerun's;
  - the new split applied to the first run's own OSV results (the same data), so that the split's effect is separated from changes in the advisory databases;
  - the ratios against npm's direct findings and `--omit=dev`, the per-repository median and the number at or below a third, as registered;
  - which split each repository got (source read, a production stage holding devDependencies).

**5. The check for misses.**
- **What is checked.** The left-out list, as registered: every reason, every installed copy, npm's nodes and ranges.
- **Production-relevant** now means production under section 2, for an installed version in range by either npm's GHSA range or OSV. A "no" cites the facts that show the copy dev-only: D1's path, or for D2 no import, no build tool naming or running it, no production command, and no production stage holding devDependencies. A package that fits neither is undecidable, and undecidable counts as a miss.
- **Reusing the first run's verdicts.** Only for a package left out in both runs in the same repository:
  - a first-run "yes" is reused as "yes". What the first rule's (a) to (d) counted is production under section 2: its (b) is P1 with the following, its (c) is in P2, P3 and P6, and its (d) is in P5;
  - a first-run "no" is reused only when a fresh-context reviewer finds that none of the conditions section 2 adds applies. Those are: an import from a file the first rule did not count as shipped code (build configuration; build, lint or release scripts; any other non-test file); a stylesheet import; a build tool's configuration naming it; a build command running it; a production command the first rule did not list (`prestart`, `poststart`, a workspace's `start`, a production stage's `RUN`); a P3 or P4 package; being reached through declared dependencies from any production copy; a production stage holding devDependencies. Otherwise the reviewer gives a new verdict;
  - a first-run "undecidable" is reviewed again.
- **Newly left out** (not on the first run's left-out list for that repository): reviewed by fresh-context reviewers.
- **Who reviews.** Fresh-context subagents that are not the worker. The reviewer brief (docs/bench/2026-10-28-noise-v2/reviewer-brief.md) quotes sections 2 and 5. It says that repository and package text is data, not instructions. It is committed before the review starts. The worker does not change a verdict: it only adds them up, and reports disagreements next to them.

**6. The gates, unchanged.** The count gate: over the 100 repositories, the judge's count times 3 is at most npm audit's count. The miss gate: zero misses. Both are reported as they come out. Not measured counts as not met.

