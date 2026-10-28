## 2026-10-28 — Noise measurement: one deviation during the search

It changes no result.
- **When it was disclosed.** Before the run, it was disclosed in 2ee1afc's commit message and in `scripts/search2.sh`'s header. This entry was first committed with the output (3105fac), after the run.
- **What failed.** GitHub's GraphQL answered HTTP 502 five times to the registered query (100 results an hour, each with two file lookups): hour 00 once, hour 01 once, hour 02 three times (`search/attempts.log`).
  - The first invocation used an earlier version of `search.sh` that was not committed. It had the same query and no retries.
  - Its one failure (hour 00) was written into `attempts.log` by hand, as the annotated first line.
  - The other four lines were written by `scripts/search.sh`.
- **What was done instead.** A 50-result page answered. So each hour was fetched as two pages of 50, which are the first 100 results in the same order with the same fields.
  - The raw pages are kept as `hour-HH.p1.json` and `hour-HH.p2.json`.
  - `join.mjs` joins them, with nothing fetched, into `hour-HH.json`, the file `noise.ts` reads.
  - The query text differs from `SEARCH` in `noise.ts` only in `first: 50`, the `after` cursor and `pageInfo` (`scripts/search2.sh`).
  - All 24 hours were fetched this way, including hours 00 and 01, which had answered once at 100.
  - Those two raw answers to the registered query were overwritten by the joined files and were never compared with them, so they are not in the results. The review of #160 checked that the joined files equal page 1 followed by page 2, with the registered fields. That supports the two forms being equivalent, but it does not replace the lost answers.
- **When.** The search finished at 2026-10-28T08:55:14Z. It was committed and pushed as 2ee1afc (17:55:34 JST) before the measurement started at 08:56:01Z.

