# 2026-10-29 (L1) — The noise count by package: 560 → 938, all from section 2's rules; not fixed, not re-measured

docs/bench/2026-10-29-l1-count-breakdown. The analysis reads the committed noise.json files and changes neither. It recomputed the split over the 100 repositories' lockfiles and source trees, offline in Docker, at c381a85 and at main (3b6ed1c). Both reproduce the rerun's 938 exactly, with 0 mismatches. The source archives, fetched again, equal the rerun's (SHA-256 and file count, 101 of 101).

- **378 added pairs** (repository, package), in 62 of the 100 repositories, over 110 package names. No package is counted less.
  - By the first run's verdict: no 211, undecidable 102, yes 65.
  - By the rule the judge recorded: P2 134, P1 85, P3 60, P6 47, P5 33, D1 only 11, P4 5, P0 3.
- **Most come from following declared dependencies out of a seed.** The largest seeds:
  - vite as a bundler helper (P3): 43 pairs;
  - `nuxt build` (P6): 30;
  - vitest imported by build configuration or helper files (P1 22, P2 13, P5 3);
  - shadcn imported by stylesheets: 21;
  - Angular's builders named in `angular.json`: 32.
- **Largest packages:**

  | Package | First run | Rerun | Added |
  | --- | --- | --- | --- |
  | vite | 13 | 41 | +28 |
  | undici | 11 | 29 | +18 |
  | @vitest/mocker | 0 | 17 | +17 |
  | esbuild | 1 | 15 | +14 |
  | deepmerge | 15 | 28 | +13 |
- **No over-count against section 2 was found** in the 378 additions.
  - One command seed reaches a nested copy npm would not run (vitepress's own vite). Another rule also makes that copy production, so no count changes.
  - Narrower readings would be definition changes: vitest's `*.x.config.ts`, `external` and exclusion lists, JSON keys outside PostCSS, type-only references and `$schema` paths in build configuration, and D1 only for a whole lockfile. All of them together are at most about 280 pairs, short of the 316 the gate needs. They are left to the owner (docs/decisions/2026-10-29-l1-count-not-fixed.md).
- **Gates, unchanged:** count not met (938 × 3 = 2,814 > 1,867; the gate needs 622 or less); misses not met (11 in 4 repositories).
