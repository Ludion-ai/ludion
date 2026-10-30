# LR — stopped before the pool was complete (2026-10-30)

The code search (`scripts/search.sh`, decision 2026-10-30-lr-dockerfile-lag-definitions, section 6.1) started at 2026-10-30T11:49:06Z. It was stopped from outside before it finished, because the machine ran low on memory. It was not restarted.

Done at the stop, per `raw/search-pages.tsv` (225 pages, no error lines):

- php: all 11 queries, 10 pages each; 11,000 hits, 7,822 unique repositories.
- node: `node:10` to `node:20`, 10 pages each, and `node:21` pages 1–6; 11,600 hits, 8,187 unique repositories.
- Not run: `node:21` pages 7–10 and `node:22` to `node:26` (54 pages).

No repository has been chosen or counted (`scripts/select.sh` and `scripts/analyze.mjs` have not run on real data). There are no results. The pool in `raw/` is incomplete, and is not the pool the decision defines until the missing pages are added.
