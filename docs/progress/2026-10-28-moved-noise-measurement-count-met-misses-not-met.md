## 2026-10-28 (cycle 2) — Noise measurement: count met, misses not met

docs/bench/2026-10-28-noise. The definitions were fixed before the run: d29b1e7, then amended up to b394292 after six review rounds on #155, merged as 3418d55. The search was committed first (2ee1afc), with one recorded deviation: pages of 50 after HTTP 502s. The first execution ran from 17:56:01 to 18:13:03 JST, and its output was committed as 3105fac.

- **Sample.** 100 public repositories with Dependabot npm PRs on 2026-10-27, from 256 considered.
- **Count gate: met.** npm audit 1,867 against the judge's production count 560 (1,680 ≤ 1,867).
  - Shown, not gated: against npm's direct findings the judge's count is 0.515 of it, and against `--omit=dev` 0.604.
  - The per-repository median ratio is 0.2169.
- **Miss gate: not met.** Five fresh-context subagents checked all 538 left-out packages against advisories and code.
  - Verdicts: 65 yes, 371 no, 102 undecidable. That is 167 misses in 32 repositories.
  - All 538 were left out as dev-only per the lockfile. Some yes verdicts are packages a production build or runtime takes from devDependencies: dompurify in a deployed bundle, shipped Electron runtimes, esbuild under `tsx` in a production image, markdown-it bundled through graphiql. Many other misses count only because of the rule's wording ((b)'s declared-dependency reach, (d)'s `start`) or because they are undecidable. The reviewers' evidence for 88 of the 102 undecidable verdicts shows no shipped code loading the package.
  - The reviewers read parts of the rule differently ((b) dependency reach, (d) dev-server starts, (c) bundler helpers, CSS-only imports). The README reports those differences next to the tally. Some yes verdicts depend on none of them, so the gate fails under any of those readings.
- **One judge failure.** The judge's lockfile reader refused one repository's lockfile (an unexpected `packages/` path under `node_modules`). That repository was excluded and reported by cause.

The design's noise gate is **not met**. The judge's production/dev split (the lockfile's `dev` flag) cannot by itself decide "loaded in production". No definition is changed.

