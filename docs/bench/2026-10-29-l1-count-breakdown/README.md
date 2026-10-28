# The noise rerun's count, by package: why 560 became 938 (lane L1, 2026-10-29)

The noise rerun (docs/bench/2026-10-28-noise-v2, #168) did not meet the count gate: the judge's production count was 938 against npm audit's 1,867 (938 × 3 = 2,814 > 1,867). The first run's count was 560. This folder breaks the increase down by package and by the rule that made each added package production, and asks whether the code counts anything that section 2 of the definitions (docs/decisions.md, "Gate 1's production/dev split, rebuilt") does not call production. It changes no definition, gate or wait, and no raw data: both runs' `noise.json` and the review verdicts are read as they are.

## Result

- **All 378 additions come from section 2's own rules.** For every one, the rule and the copy it started from are named below. None comes from code that reads more than section 2's text, so there is nothing to fix without changing the definition (see "Is anything over-counted?").
- **So nothing was fixed and nothing was re-measured.** The count gate stays not met (938 × 3 = 2,814 > 1,867), and the miss gate stays not met (11 misses in 4 repositories). Both numbers are #168's, unchanged.
- To meet the count gate on this sample, the judge's count would have to be at most 622 (1,867 / 3 = 622.3), so 316 fewer than 938. Only a change to the definition can do that. That is the owner's decision, with a new entry and a new run, and is not made here.

## How it was computed

- `scripts/breakdown.ts` recomputes the split (`productionSplit`) for each of the 100 repositories from its package-lock.json, package.json and source tree at the recorded SHA. It reads the version of production.ts given to it, once at c381a85 (the code that produced 938) and once at main (3b6ed1c, which has #168's later reader fixes). The vulnerable versions are the rerun's own OSV results from `result/noise.json`. Nothing is queried, and no project code runs.
- **The check.** For every vulnerable package in every row, the recomputed production flag must equal the rerun's. Both versions gave 938, with 0 mismatches (`mismatches: []` in both outputs). main's reasons differ from c381a85's in one (repository, package) pair (the recorded seed path), and in no count.
- **The sources** were fetched again into a new volume (`ludion-l1b-src`) with the rerun's own `scripts/sources.mjs`, unchanged, in Docker: 101 of 101. Every archive's SHA-256 and file count equal the rerun's `sources-log.json` (101 of 101; this folder's `sources-log.json` is the new log). Its `fetched_at`, 2026-10-28T15:24Z, is UTC: 2026-10-29 00:24 JST. The earlier L1 volumes were not used.
- **How it ran.** In Docker: node:24-slim@sha256:55fb5f5a…, a read-only root, a non-root user, no network, no forwarded environment, the sources read-only. `scripts/render.mjs` (also in Docker) writes `packages.md` from the c381a85 output.
- **What a reason is.** production.ts records one `why` for each production copy. It is either a rule's reason (the "seed") or "a dependency of X at P, which is production". The breakdown follows that chain from the vulnerable copy up to its seed.
  - Following is a breadth-first search from all seeds at once. So a copy reached from several seeds keeps the reason of the nearest one, the one with the fewest dependency steps.
  - Ties go to the seed added first, in this order: P0 and P4 for each entry, then P3, then the source files in path order, then P5 and P6 commands, then the D1-only fallback.
  - A seed keeps only its first reason.
  - A package with several vulnerable production copies is classified by the first of them in lockfile order. `rules_reaching` lists the rules of every seed that reaches the copy through production copies, each seed by its recorded reason only, so it can miss a second rule that also applies to the same seed.

## Where the 378 come from

**By the first run's verdict** (the first run left all 378 out; its reviewers had judged them):

| First-run verdict | Pairs |
| --- | --- |
| no | 211 |
| undecidable (b) | 77 |
| yes (b) | 44 |
| undecidable (d) | 20 |
| yes (c) | 11 |
| yes (d) | 10 |
| undecidable (c) | 5 |
| **All** | **378** |

So 167 were first-run misses (yes or undecidable), and section 2 counts all of them. The other 211 are first-run "no" verdicts that section 2 calls production.

**By the rule the judge recorded:**

| Rule | Pairs | Only this rule reaches it |
| --- | --- | --- |
| P2: a build tool's configuration names it (or what it depends on) | 134 | 117 |
| P1: the source imports it | 85 | 78 |
| P3: a bundler helper library | 60 | 10 |
| P6: the build runs it | 47 | 18 |
| P5: a production command runs it | 33 | 29 |
| D1 only (a production image holds devDependencies, or the source is incomplete) | 11 | 11 |
| P4: a shipped runtime (electron) | 5 | 5 |
| P0: not dev in the lockfile, followed through peer or optional dependencies | 3 | 1 |
| **All** | **378** | 109 reached by more than one rule |

- 337 of the 378 are in the 90 repositories where both D1 and D2 apply. 41 are in the 10 repositories where only D1 applies (9 with a production image holding devDependencies, 1 with an incomplete source tree). There, 11 are made production only because D2 cannot be used.
- 62 of the 100 repositories count more than before. No repository counts fewer, and no package is newly left out.

**By seed.** Most additions are packages that a seed depends on, not the seed itself. Following declared dependencies from a production copy (section 2, "Following") turns a whole build tool's dependency tree into production. The seeds behind the most pairs:

| Seed | Rule | Added pairs | Repositories |
| --- | --- | --- | --- |
| vite | P3 | 43 | 27 |
| nuxt | P6 (`nuxt build`) | 30 | 2 |
| vitest | P1 | 22 | 9 |
| shadcn | P1 (a stylesheet's `@import "shadcn/…"`) | 21 | 3 |
| @angular-devkit/build-angular | P2 (`angular.json`) | 20 | 2 |
| webpack-dev-server | P5 | 14 | 2 |
| vitest | P2 (`vite.config.*` and `angular.json`) | 13 | 8 |
| @angular/cli | P2 (`angular.json`) | 12 | 2 |
| @nuxt/content | P2 (`nuxt.config.ts`) | 10 | 1 |
| esbuild | P3 | 10 | 10 |
| @11ty/eleventy | P5 (`start`) | 9 | 2 |

The full list, and every added package with its first-run and rerun counts and its reasons, is in `packages.md`.

**By package.** 110 of the 211 vulnerable package names counted in the rerun were added in at least one repository. The ten largest:

| Package | First run | Rerun | Added | Main reasons |
| --- | --- | --- | --- | --- |
| vite | 13 | 41 | +28 | P3 (vite itself) 27, P6 1 |
| undici | 11 | 29 | +18 | P1 9, P2 5, P6 2, D1 only 1, P4 1 |
| @vitest/mocker | 0 | 17 | +17 | P1 8, P2 8, P5 1 (all through vitest) |
| esbuild | 1 | 15 | +14 | P3 10, P1 2, P5 1, P6 1 |
| deepmerge | 15 | 28 | +13 | P2 6, P1 3, P6 3, P5 1 |
| source-map-js | 19 | 31 | +12 | P3 9 (vite), P2 2, P5 1 |
| qs | 17 | 29 | +12 | P2 5, P1 3, P6 2, P5 2 |
| brace-expansion | 8 | 20 | +12 | P2 5, P1 5, P5 1, D1 only 1 |
| body-parser | 11 | 22 | +11 | P1 5, P5 3, P2 2, P6 1 |
| fast-uri | 12 | 22 | +10 | P2 5, P1 3, P6 1, P0 1 |

## Is anything over-counted?

The question is whether the code makes a copy production when section 2's text does not. Each kind of seed among the 378 was compared with section 2:

- **P3.** vite, esbuild, rollup and webpack are in section 2's P3 list. Section 2 follows their declared dependencies, so vite's postcss, nanoid and source-map-js are production.
- **P2.** Every P2 seed is a quoted string, or a `node_modules/<name>` path, in a file section 2 lists as a build tool's configuration. That includes `vite.config.ts` importing `vitest/config`: vite.config.ts is a P2 file, and its P2 seed is added before its P1 one. Section 2 counts a quoted name, whatever it says about the package. Several P2 seeds name a package without using it:
  - names that keep a package out of the output: tsup's `external` naming astro (8 pairs), electron-builder's `"!**/node_modules/app-builder-lib/**"` exclusions (`files`);
  - test settings: `test.environment: "jsdom"` in `vite.config.ts`;
  - JSON object keys: angular.json's `"glob": "**/*"` (1 pair) and nx.json's generator defaults `"@nx/react": {` (3 pairs). The code reads keys in every JSON configuration. Section 2 says "in PostCSS configuration also an object key", which can be read to mean keys elsewhere are not names;
  - a project's or target's own name that equals a package: `apps/storybook/project.json`'s `"name": "storybook"` and nx.json's `"serveStorybookTargetName": "storybook"` (2 pairs);
  - type-only references: `/** @type {import('@sveltejs/kit').Config} */` (3 pairs), `import('postcss-load-config')` in a JSDoc comment (1), and `/// <reference types="vitest/config" />` or `types='vitest'` (3). Section 2 excludes `import type` from imports, but P2's "named" has no such exception;
  - `$schema` paths into node_modules: `./node_modules/@angular/cli/lib/config/schema.json` in angular.json (the 12 @angular/cli pairs, in 2 repositories) and `./node_modules/nx/schemas/…` in nx.json (5). Section 2's "An import" counts a node_modules path in a build tool's configuration.

  Counts are by recorded seed. Another seed of the same rule may also reach some of these pairs. The reviewer of #186 found these kinds; the counts are theirs.
- **P1.** Every P1 seed is a literal import or a `node_modules/` path in a file section 2 calls source, or a `node_modules/` path in a package.json script, which section 2's "An import" also counts:
  - stylesheets importing shadcn;
  - build configuration that is not a P2 file (`drizzle.config.ts` importing drizzle-kit);
  - scripts (`scripts/build.js`, `build/*.ts`);
  - package.json scripts: `wrangler` in `start`, `node_modules/mocha/bin/_mocha` in `test` (the latter also reached by P2, P3 and P5, so it changes no count);
  - a generated file that embeds a lockfile as a string: `src/lib/agent-seed.generated.ts` in nikolanovoselec/codeflare (body-parser and fast-uri, P1 only);
  - files whose names look like tests but are not in section 2's list: `test.setup.ts`, `test-mocks.ts`, `test-browser-setup.ts`, `.vscode-test.mjs`;
  - test-runner configurations with an extra name part: `vitest.integration.config.ts`, `vitest.enterprise.config.ts`, `vitest.ssh.config.ts`, `vitest.extension.config.ts`. The code reads section 2's "`.config` files of `vitest`" as `vitest.config.*`, `vitest.conf.*` and `vitest.workspace.*` only.

  A P-rule beats D1 (section 2: "A dev-marked copy that no P-rule makes production is dev-only when…"). So vitest and its dependencies (@vitest/mocker, tinypool) are production when source imports vitest.
- **P5 and P6.** The seeds are run by a `start` script, a script it calls, or a `build` script (`nuxt build`, `vue-cli-service build`, `nest build`, `vsce package`, `eleventy`). Test runners are not made production by P6, as section 2 says.
  - One seed is wider than npm would run. `badr-pdf`'s build runs `vite`, and the code seeded every copy whose `bin` is `vite`, including `node_modules/vitepress/node_modules/vite`, which is not on the script's PATH. That copy is also reached from a P1 seed, so it stays production and changes no count.
- **P0.** Three pairs are dev-marked copies reached from a non-dev copy through peer or optional dependencies, which section 2 follows (`@hookform/resolvers` → `ajv` → `fast-uri`, `http-cookie-agent` → `undici` → `@fastify/busboy`, `@matbee/libreoffice-converter` → `sharp`).
- **D1 only.** In the 10 repositories without D2, section 2 makes every declared non-D1 dependency production: concurrently, @lhci/cli, jsdom, pino-pretty, glob, wait-on.

**What this does not show.**
- The vitest config files with an extra name part are a reading, not an error. Reading them as test-runner configuration would leave out 11 pairs. That would be a narrower definition chosen after seeing the result, so it is not made here.
- The same holds for every P2 and P1 seed listed above that names a package without using it: exclusion lists and `external`, JSON keys outside PostCSS, a project's or target's own name, type-only references, `$schema` paths, and a lockfile embedded in a generated file. Section 2 has no "named in order to be left out" or "named only as a type". Narrowing any of them now would be choosing a narrower definition after seeing the result.
- This check covers the 378 additions. The 560 that both runs count were not checked again. The first run's split was the lockfile's `dev` flag alone, with no following. Section 2's P0 keeps every copy that flag counted, and following only adds copies. (The 3 P0-recorded additions exist because following through peer and optional dependencies is new.) No name was newly left out.

## What would change the count

These are definition changes, for the owner. None is made or measured here.

- **D2 with a production image.** In the 9 repositories whose production image holds devDependencies, the whole lockfile gets D1 only, even where the image installs from a different folder (`server/Dockerfile`, `apps/api/Dockerfile`).
- **Following the dependencies of build tools.** vite (43 pairs), nuxt (30), @angular-devkit/build-angular and @angular/cli (32), webpack-dev-server (14), @11ty/eleventy (9) and @nuxt/content (10) account for 138 of the 378 pairs. Section 2's "Following" makes everything they depend on production, whether it reaches the output or not.
- **Test runners imported by build configuration or helper files.** vitest seeds account for 38 pairs (P1 22, P2 13, P5 3).

- **The narrower readings in "What this does not show".** These are the vitest configuration names (11 pairs) and the P2 and P1 seeds that name a package without using it. By recorded seed, the latter are about 50 pairs, counting every electron-builder.json seed as an exclusion.

Even leaving out every one of these would not by itself bring 938 to 622 or less. These groups add up to at most about 280 pairs (138 + 38 + 41 in the D1-only repositories + 11 + about 50), and they overlap. The #186 review counted the union of the pairs these changes can touch, by recorded seed or chain: about 200 to 235 (about 230 to 245 with a wider list of build tools, whose plain sum is at most 294). The gate needs 316 fewer. The 560 both runs count stay. (By recorded seed, the seven named build tools account for 139 pairs: vite also has one P6 seed, the vitepress-nested copy in badr-pdf.)

## Files

- `scripts/breakdown.ts`: the breakdown. `result/breakdown-c381a85.json` (the code that produced 938) and `result/breakdown-main-3b6ed1c.json` (main) hold, per repository, every counted package. For each added one, they hold its first-run verdict, the recorded chain to its seed, the seed's rule and reason, and the rules of every seed that reaches it. Per package, they hold the counts and reasons, plus the tallies above.
- `scripts/render.mjs` → `packages.md`: the tables by seed and by package.
- `sources-log.json`: this fetch's log (archive SHA-256 and file counts, equal to the rerun's).
