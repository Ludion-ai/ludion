# 2026-11-02 — LRATIO: the readers' time is measured as a ratio from n to 4n, not against fixed limits

**Lane LRATIO**, from main 728fcf1, after a first-principles audit (2026-11-02) found that packages/cli/test/dockerfile-check.test.ts said "linear time" from limits of 50 ms, 1 s and 4 s, and that #258's N1 and `lock-key-many-deps` had no owner. No code under packages/cli/src changes. Mistake: docs/mistakes/2026-11-02-linear-said-with-fixed-ms.md.

## What changed

- packages/cli/test/dockerfile-check.test.ts: its first lines and its describe names now say "these shapes". `answersWithin` and the three limits are gone. `gate-reader-scaling-ratio` takes the place of `gate-reader-linear`. `lock-key-many-deps` and `gate-reader-scaling-ratio-control` are new. 182 tests become 191.
- docs/progress/2026-11-02-ldock-dockerfile-check.md and docs/mistakes/2026-11-02-dockerfile-check-not-as-buildkit-reads.md: the sentences on `gate-reader-linear` say what it held, and point here.

## The measure

Each point is the median of up to 7 samples of CPU time (`process.cpuUsage`, user and system, of the whole process), taken in turn at n and 4n, after one round thrown away. A sample repeats the call so that the smaller takes at least 4 ms of CPU, the same number of times at both sizes. The line is a ratio under 8; a time that grows with n gives about 4 and with n² about 16.

- **Dockerfile shapes:** the 41 inputs `gate-reader-linear` had, each at 16 KiB and 64 KiB, for each of `phpImage`, `nodeImage` and `namesNodeImage`: 123 measures. `officialImage` refuses over 64 KiB before reading, so n cannot be larger than 16 KiB; repeating the call is what makes a short sample long enough. No shape was taken out.
- **Lock shapes:** the 8 inputs `gate-reader-linear` had, each grown by what grows on it, plus 3 grown by the number of keys: one key from 1 MiB to 4 MiB (3), 1,000 keys from 1,024 characters to 4,096 (5), and 250 keys of 4,096 characters to 1,000 (3). `lockKey` is now timed alone, over all the keys of a lock; it was 10 rounds plus reading the lock before. A key's length and the number of keys need separate rows: on the old expression only the first gave a high ratio (below).

Limits that remain, none of which decides what is linear: 5 s (Dockerfile) and 30 s (lock) for a sample, under Node's VM, so a backtracking expression fails and does not hang; and 15 s for a measure, after which it stops at 3 samples at the fewest and fails nothing. These are clock time, as are the tests' own 60 s and 120 s. In the runs of the next section the longest test took 19.88 s.

CPU time is the whole process's, so the file must not share its process with another test file's thread. `gate-reader-scaling-ratio-control: this file is not in a worker thread` holds that part: with `--pool=threads` it failed (one run).

## On this head, in Docker

Runs of `vitest run --project node --maxWorkers=2 packages/cli/test/dockerfile-check.test.ts -t "gate-reader-scaling-ratio|lock-key-many-deps"`, Node 24.22.2, `--network none --memory 2g`. "Highest" is of the 134 under the line (123 + 11). The busy loops are shell loops in the same container.

| Container | Run | Tests | Failed | Seconds | Control n | Control n² | Highest of the 134 |
|---|---|---|---|---|---|---|---|
| No limit | 1 | 58 | 0 | 47.04 | 4.12 | 15.79 | 6.05 `lines of #, phpImage` |
| No limit | 2 | 58 | 0 | 47.49 | 3.93 | 15.64 | 5.89 `backslash-newline pairs, phpImage` |
| No limit | 3 | 58 | 0 | 47.42 | 4.03 | 15.67 | 5.69 `backslash-newline pairs, nodeImage` |
| `--cpus 0.25` | 1 | 58 | 0 | 148.00 | **7.31** | 16.08 | 5.80 `backslash-newline pairs, nodeImage` |
| `--cpus 0.25` | 2 | 58 | 0 | 151.19 | 3.98 | 15.96 | 5.99 `backslash-newline pairs, phpImage` |
| `--cpus 0.25` | 3 | 58 | 0 | 153.10 | 3.97 | 15.56 | 6.08 `backslash-newline pairs, phpImage` |
| `--cpuset-cpus 0`, 3 busy loops | 1 | 58 | 0 | 162.25 | 4.07 | 15.95 | 6.62 `backslash-newline pairs, nodeImage` |
| `--cpuset-cpus 0`, 3 busy loops | 2 | 58 | 0 | 159.78 | 4.17 | 16.19 | 6.70 `backslash-newline pairs, nodeImage` |
| `--cpuset-cpus 0`, 3 busy loops | 3 | 58 | 0 | 162.23 | 4.04 | 16.11 | 7.07 `backslash-newline pairs, nodeImage` |
| `--cpus 1`, 3 busy loops | 1 | 58 | 0 | 156.01 | 4.18 | 15.97 | 6.52 `lines of #, phpImage` |
| `--cpus 1`, 3 busy loops | 2 | 58 | 0 | 159.20 | 4.26 | 16.27 | 6.19 `backslash-newline pairs, nodeImage` |
| `--cpus 1`, 3 busy loops | 3 | 58 | 0 | 161.40 | 3.77 | 16.38 | **7.27** `backslash-newline pairs, phpImage` |
| `--cpuset-cpus 0`, 3 neighbours that walk 128 MiB of memory | 1 | 58 | 0 | 162.11 | 4.08 | 16.18 | 6.91 `backslash-newline pairs, nodeImage` |

**Runs that failed in the 3 limited containers of the review: 0 of 9 (95% upper bound 28%).** With no limit: 0 of 3 (63%). With the neighbours that walk memory: 0 of 1 (95%). The margin is thin: 7.31 and 7.27 against a line of 8. The 7.31 is a plain scan, once, in the first measure of the run: its time at n was 0.0166 ms a call, where the other runs gave about 0.030. Why was not looked into; nor was why the shapes of many short lines go over 4. No retry was added.

`lock-key-many-deps` over these 13 runs: `packageLockInputs`, 200 dependencies, key of 1,019 then 4,034 characters: 13.34 to 13.97. `resolveFrom` alone, the same keys: 13.74 to 14.55. `packageLockInputs`, key of 4,034 characters, 50 then 200 dependencies: 3.94 to 4.04.

So on this shape `packageLockInputs` is quadratic in a key's length and grows with the number of dependencies about as that number does, and `resolveFrom` alone grows as much (a measure, where #258's record read it from the code). 656 to 709 ms of CPU at 200 dependencies is 3.3 to 3.5 ms a dependency, and #258's 37,105 ms at 10,000 is 3.7. This PR does not fix it. The two tests that say "from 8 up to 32" fail when it is fixed: with `resolveFrom` changed in a copy to look in one place only, they gave 2.34 and 3.69 and failed, and the third gave 3.58 and passed. That change is not a fix, and it was not kept.

## Why CPU time: clock time failed with no reader changed

This PR's first head, f7f4206, measured clock time (`performance.now`). The review of that head ran each of these once, with `--memory 4g`, on the 57 tests it had then; main's 49 `gate-reader-linear` tests passed in the two containers it also ran them in:

| Container | Failed, of 57 | Control n / n² | Highest of the 134 | main's limits, of 49 |
|---|---|---|---|---|
| No limit | 0 | 4.00 / 15.90 | 5.89 | not run |
| `--cpus 0.25` | 38 | 20.72 / 63.42 | 34.05 | 0 failed |
| `--cpuset-cpus 0`, 3 busy loops | 28 | 4.35 / 16.47 | 19.68 | 0 failed |
| `--cpus 1`, 3 busy loops | 45 | 20.09 / 59.49 | 36.14 | not run |

With this section's `--memory 2g`, `--cpus 0.25` on f7f4206 gave `Tests 39 failed | 18 passed`, one run. The same first head with no limit and `--memory 4g`, 3 runs: 57 passed each, highest 6.00, 6.10, 6.77.

Why the time at 4n suffered more, on a plain scan of 8,000 then 32,000, warmed up, with the small sample set by its CPU time, the median of 21 samples, one run of each:

| Container | CPU time of a sample | Clock time of a sample | Clock ratio | CPU ratio |
|---|---|---|---|---|
| No limit | 3.96 and 15.59 ms | 3.96 and 15.60 ms | 3.94 | 3.93 |
| `--cpus 0.25` | 3.94 and 15.50 ms | 3.95 and 88.78 ms | 22.47 | 3.94 |
| `--cpus 0.25` | 15.82 and 63.53 ms | 89.95 and 286.32 ms | 3.18 | 4.02 |
| `--cpuset-cpus 0`, 3 busy loops | 0.94 and 3.83 ms | 0.97 and 15.87 ms | 16.35 | 4.07 |
| `--cpuset-cpus 0`, 3 busy loops | 3.81 and 15.26 ms | 16.00 and 63.99 ms | 4.00 | 4.00 |
| `--cpus 1`, 3 busy loops | 8.55 and 33.67 ms | 8.74 and 111.36 ms | 12.75 | 3.94 |
| `--cpus 1`, 3 busy loops | 4.10 and 17.74 ms | 77.82 and 21.07 ms | 0.27 | 4.33 |

So a short sample can run with no wait while the long one after it takes the whole wait, and the clock ratio then depends on where the wait falls, not on the reader. This shows that on the scan, not on the readers. CPU time steps by 1 µs in these containers (read in a tight loop).

## What this measure still catches, and what it does not

A real n² in a copy of the code: a loop of n²/32 reads at php.ts:108, in `officialImage`. One run each. It is not committed.

| Container | Tests | `phpImage` ratio, lowest and highest of 41 | Seconds |
|---|---|---|---|
| No limit | 41 failed, 17 passed | 13.64, 16.11 | 78.90 |
| `--cpus 0.25` | 41 failed, 17 passed | 12.34, 21.86 | 273.29 |
| `--cpuset-cpus 0`, 3 busy loops | 41 failed, 17 passed | 13.09, 16.16 | 275.20 |
| `--cpus 1`, 3 busy loops | 41 failed, 17 passed | 12.32, 21.52 | 290.61 |

Not caught, both shown on the one shape `line feeds`, in a copy, with no limit:

- A reader slower by the same factor at both sizes: a busy wait of 1 s at 16 KiB and 4 s at 64 KiB gave 4.00 on `phpImage` and `nodeImage`, and the test passed.
- A time that uses no CPU: an `Atomics.wait` of 1 ms at 16 KiB and 16 ms at 64 KiB, n² in clock time, gave 3.60 on `phpImage` and 3.18 on `nodeImage`, and the test passed. The readers wait for nothing today.

## Red: on the readers from before #258

The test file of this head, on php.ts, node.ts and judge.ts of d42e172, in Docker with no limit (`Tests 18 failed | 40 passed | 133 skipped`, 510.99 s):

| Shape | Ratio, or what stopped it |
|---|---|
| `line feeds`, `phpImage` | 15.98 (221 and 3,531 ms) |
| `CRLF pairs`, `phpImage` | 15.94 |
| `lines of a space`, `phpImage` | 15.92 |
| `COPY and spaces`, `phpImage` | 15.86 |
| `line feeds, COPY and spaces`; `line feeds, RUN and spaces` | the 5 s guard |
| `COPY, tabs and spaces`, `phpImage` | 15.92 |
| `RUN and spaces`, `phpImage` | 16.03 |
| `a run of carriage returns`, `phpImage` | 15.86 |
| `a run of carriage returns, then a letter`, `phpImage` | 15.87 |
| `two carriage returns and a line feed, many times`, `phpImage` | 16.10 |
| `lockEntries`, one key; the same, extraneous; `lockExtraneous`, extraneous | the 30 s guard |
| `lockEntries`, 1,000 extraneous keys, 1,024 then 4,096 characters | 12.56 (38 and 482 ms) |
| `lockExtraneous`, the same | 13.05 (37 and 478 ms) |
| `lockKey`, the same | 13.71 |
| `packageLockInputs`, the same | 13.02 (736 and 9,588 ms) |

A test stops at its first reader that fails, so `phpImage` stands for the shape here. Not failed there: `lockEntries` on 1,000 install paths (3.42), and the three rows grown by the number of keys, 250 to 1,000 (3.99, 4.01, 4.01), as the old expression's time was in a key's length. `packageLockInputs` took 9,588 ms of CPU a call at 1,000 keys on that code.

The test file of main 728fcf1, on the same old readers, failed 16 of `gate-reader-linear`'s 49: the same 11 Dockerfile shapes, the 3 of one key, `lockKey` and `packageLockInputs`. So the ratio fails every shape the limits failed, and 2 they passed, `lockEntries` and `lockExtraneous` on 1,000 keys, at about 480 ms under the 1 s limit.

## CI

The same tests' 4 runs on GitHub's runner at f7f4206, and the run at this head, are in this PR's description, with the ratios from each run's log (`scaling ratios:`, printed once at the end of the file).
