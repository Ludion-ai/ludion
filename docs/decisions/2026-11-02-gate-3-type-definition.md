# 2026-11-02 — Gate 3's new type: what one judgement of one fix is (LG3)

Committed before any of it was implemented or measured. It writes down, for the code, the section 「C4 壊さない」 of docs/decisions/2026-11-02-definition-of-complete-final.md (the plan's text, at that file's lines 128 to 144). That section wins where the two differ, and CLAUDE.md wins over both until the protected PR lands. This file narrows and loosens nothing in it, and changes no wait and no numeric criterion of a gate.

The section's words this writes down:

> **古い版を仕様にする。** ビルドと型の確かめ。起動して GET のページを全部開き、状態コード、例外、コンソール、DOM（一次）、スクリーンショット（二次）を比べる。古い版を 2 回動かしてノイズを除き、時計は止める。テストがあれば両方。

> **分母：** 古い版で状態 200・例外 0 のページが 1 つ以上ある（プロジェクト, 修正）だけ。［…］分母に入らないものは関門 3 が判定不能なので、pr に落とす。

> `.env.example` があれば、その鍵にダミー値を入れてビルドする。

> **限界：** 見るのは GET のページだけ。API ルート、Server Actions、動的ルート（\[id\]）は触らない。受け取りに書く。

## What goes in and what comes out

In: one project's source, and its package.json and package-lock.json before the fix (old) and after it (new). Out: one of three verdicts, with every reason, per-page results and the seconds of each step.

| Verdict | Meaning | What it leads to |
|---|---|---|
| `not_broken` | Everything compared came out the same as on old | Gate 3 does not stop the fix |
| `broken` | Something that worked on old does not work on new | The fix stops, with the reasons |
| `undecidable` | Gate 3 cannot say | Falls to a PR for a person ("pr に落とす"); never an automatic apply |

This first form covers npm projects that build with Next.js. Any other project is `undecidable`, with that reason. Which version of Next.js and which build setups it works on is measured, not assumed: see Limits.

## The steps

Dependencies are acquired outside the box, from the manifests alone, with `npm ci --ignore-scripts` and the same pinned npm and flags as `ludion patch`, on a network. No project source is in that step. Everything after it runs inside packages/sandbox's box, with no network, a read-only root, a non-root user and resource limits, and packages/sandbox is not changed for it. Old runs twice and new once, each in a fresh box, and each run is, in this order:

1. **Build**: the project's Next.js build. With `.env.example` in the project, each of its keys is set to a dummy value for the whole run; real `.env` files never enter the image. A file the build wants to write in the project (its next-env.d.ts, its tsconfig.json) is written in the box's scratch space, so the source stays as it was.
2. **Types**: with a tsconfig.json and TypeScript in the project, `tsc --noEmit`, whatever the project's own build settings say about type errors.
3. **Start**: the project's production server, on the box's loopback.
4. **Crawl**: every GET page, each in a real browser in the box.
5. **Tests**: with a `test` script in package.json, that script.

**The clock is stopped** in the build, the server and the browser: `Date` reads one fixed instant in all three runs, and `Math.random` gives one fixed sequence. Animations and transitions are off for the screenshot.

**Which pages.** Every page in the lists the build itself writes (Next.js's app and pages route manifests), leaving out API routes, dynamic routes (anything with `[`) and the framework's own error pages. Nothing is followed from links, so no dynamic route is reached that way. More than 200 pages is `undecidable`: "all of them" could not be kept.

**What is recorded for each page:** the final status of the document; exceptions (uncaught in the browser, and error lines from the server while the page is open); console messages with their level; the DOM once loaded (one hash per element, over its tag, sorted attributes and own text, without scripts, styles and links, and with the hashed paths under `/_next/static/` written the same); a hash of the full-page screenshot. Only hashes, counts and levels leave the box; no text of the source or of the pages does.

## How the three runs are compared

**Noise** is what differs between the two runs of old: it is left out of the comparison. An element whose hash differs between them is left out by its position. With a different number of elements, that page's DOM is not comparable. A page whose screenshot hash differs between them has no comparable screenshot. A console message or exception in only one of them is noise.

**The specification pages** are those with status 200 and 0 exceptions in both runs of old.

| Situation | Verdict |
|---|---|
| Old did not build, or its run timed out, or its result cannot be read, in either run | `undecidable` |
| No specification page (the denominator) | `undecidable` |
| Every specification page's DOM is noise | `undecidable` |
| New did not build | `broken` |
| New's server did not start | `broken` |
| Types passed on both runs of old and fail on new | `broken` |
| Tests passed on both runs of old and fail on new | `broken` |
| A specification page: no longer in new's list, or its status on new is not 200 | `broken` |
| A specification page: an exception on new | `broken` |
| A specification page: a console message of level error on new that old did not have | `broken` |
| A specification page: an element's hash differs on new outside the noise, or a different number of elements | `broken` |
| A page that answered under 500 in both runs of old and answers 500 or over on new | `broken` |
| A specification page: a console message of another level on new that old did not have | `undecidable` |
| A specification page: same DOM, but its screenshot differs from old's outside the noise | `undecidable` |
| New's run timed out, or its dependencies could not be acquired, or its result cannot be read | `undecidable` |
| None of these | `not_broken` |

`broken` wins over `undecidable` when both apply: every reason is listed. A page broken on both versions is not a difference (the section's table: 「差だけを比べる」), and the number of such pages is reported. Failing types or tests on old take no part in the comparison, and the result says so.

## Limits (these go in the receipt)

- GET pages only. API routes, Server Actions and dynamic routes are not touched. Nothing behind a login is seen, and no button or form is pressed.
- A page that needs an outside service sees none in the box, on both versions, so only a difference shows.
- The box's limits are packages/sandbox's: a project too large for them does not build on old, and that is `undecidable`.
- Which Next.js has been measured (added after measuring, 2026-11-02): 15.5.6 and 15.5.7 with webpack, and 16.4.4 with Turbopack, its default, on one machine of 16 CPUs. The driver relies on two values that are not public settings: `CIRCLE_NODE_TOTAL`, which sets the build's number of workers, and `TURBO_ENGINE_READ_ONLY`, which keeps Turbopack from writing its cache to the box's /tmp and was found in 16.4.4's native file, with no document read for it. A version that does not read them goes on building, with workers by the machine's CPUs or its cache in /tmp. Turbopack's cache folder must not be made read-only: 16.4.4 then stops with exit 1 within a second. No public setting for that cache was found that the box can use: `experimental.turbopackFileSystemCacheForBuild` is in `next.config`, the project's file. A project's own settings can still raise the workers, and its own tests may start workers by the machine's CPUs, which was not measured.
- The candidate's code runs in the same box as the crawl, so a candidate that means harm can write the result it likes. This gate says whether an update breaks things. It says nothing about whether the update is honest: that is gate 2, the wait and the re-query.
- This is a first form. It is not yet called from `ludion patch`, and docs/status.md says what is missing. Until it is, nothing may describe a receipt as having passed this gate.
- **New's build or start failing (added 2026-11-02, after this file was fixed. Source: 頭脳の決定, 2026-11-02 22:14 JST).** This replaces the table's rows "New did not build" and "New's server did not start", which stay above as they were fixed. `broken` means that what worked on old stopped working because of the fix. The box's limits are ones Ludion set and a user's production does not have, so running out of them is not that, and `undecidable` falls to a PR, where a person looks. When new's build fails, or it builds and its server does not start, new runs once more in a fresh box, so new runs at most twice. The two runs are read in this order, and the first line that applies decides:
  1. Either run has `memory_oom_kills` of 1 or more, or has /tmp nearly full: `undecidable`, reason `box_resources`, whatever else either run shows.
  2. The second run gave no result, or its build timed out: `undecidable`, reason `new_no_result` or `new_timed_out`.
  3. The second run built and started: `undecidable`, reason `flaky_new`. Its pages are not compared.
  4. Either run could not read its memory or /tmp figure: `undecidable`, reason `box_figures_missing`, since it cannot be shown that the box had room.
  5. Otherwise both failed with room in the box: `broken`, with the reasons the table gives for the first run.
- **"/tmp nearly full", fixed here before any run reads it:** less than 1,048,576 bytes (1 MiB) free in the box's /tmp of 64 MiB, at the lowest reading of the run. The driver reads the free space with `statfs` every 200 ms from its start, and once more just before it prints its result, and reports the lowest as `tmp_min_free_bytes`. The number was chosen knowing the progress record's earlier figures: builds that failed with ENOSPC with 0 KiB free, and one that passed with 348 KiB free, which nothing reads, since a run that passes is not looked at for this. Sampling can miss a moment, so a build that fills /tmp and frees it within 200 ms reads as room.
- **What this does not change.** Only new's build and start run again. New's types, tests and pages read no memory or /tmp figure, so a test that fails on new for lack of /tmp, or a page that answers nothing because the box killed the server, is still `broken`. A run of new that gives no result is still `undecidable`, with no second run.
- **Every `undecidable` reason has a name**, so that C4 can count them (`undecidable_reasons` in the result, beside the sentences, and `undecidableCounts` over many judgements, which counts each judgement once under each reason it gave and only when its verdict is `undecidable`): `not_covered` (not Next.js, or a package.json that cannot be read), `prepare_failed`, `could_not_run`, `old_no_result`, `old_failed`, `old_box_resources` (old's build, start or crawl failed with either figure above out of room), `too_many_pages`, `no_denominator`, `new_no_result`, `new_timed_out`, `new_step_absent`, `new_crawl_failed`, `box_resources`, `box_figures_missing`, `flaky_new`, `console_other_level`, `screenshot_differs`, `all_dom_noise`.
- These four items are the exception to this file's last paragraph: a later decision, not a measurement. No gate's numeric criterion and no wait changes.

## What one case costs: `c4-case-minutes-measured`

The audit's item `c4-case-minutes-measured`: the end-to-end minutes of one case, from this first form on one PC's Docker, once measured. The raw seconds of each step are in docs/progress/2026-11-02-lg3-gate-3-type.md.

| Item | Value |
|---|---|
| Example | examples/nextjs-security, next 15.5.6 -> 15.5.7 (4 pages; tiny, so it says little about C4's sample) |
| Runs | 2 of the 3 asked for; the third was stopped for lack of memory on the machine, and not run again |
| Minutes per case (each run) | 3.73 and 3.69 (223.9 s and 221.5 s), with no build cache and the images already present |
| Peak memory in the box | `memory.peak` at the box's limit, 536,870,912 bytes, on every run; `memory.swap.peak` up to 221,097,984 bytes in these runs; no OOM kill |

This table and the Limits' line on which Next.js has been measured are the only parts of this file to be filled in after measuring. Everything else above was fixed before. The table's figures are from before the box's fixes in the progress record, and were not measured again.
