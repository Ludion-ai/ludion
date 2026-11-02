# 2026-11-02 — LRATIO: the readers' time is measured as a ratio from n to 4n, not against fixed limits

**Lane LRATIO**, from main 728fcf1, after a first-principles audit (2026-11-02) found that packages/cli/test/dockerfile-check.test.ts said "linear time" from limits of 50 ms, 1 s and 4 s, and that #258's N1 and `lock-key-many-deps` had no owner. No code under packages/cli/src changes. Mistake: docs/mistakes/2026-11-02-linear-said-with-fixed-ms.md.

## What changed

- packages/cli/test/dockerfile-check.test.ts: its first lines and its describe names now say "these shapes". `answersWithin` and the three limits are gone. `gate-reader-scaling-ratio` takes the place of `gate-reader-linear`. `lock-key-many-deps` and `gate-reader-scaling-ratio-control` are new. 182 tests become 190.
- docs/progress/2026-11-02-ldock-dockerfile-check.md and docs/mistakes/2026-11-02-dockerfile-check-not-as-buildkit-reads.md: the sentences on `gate-reader-linear` say what it held, and point here.

## The measure

Each point is the median of up to 7 samples, taken in turn at n and 4n, after one round thrown away. A sample repeats the call so that the smaller takes at least 4 ms, the same number of times at both sizes. The line is a ratio under 8; a time that grows with n gives about 4 and with n² about 16.

- **Dockerfile shapes:** the 41 inputs `gate-reader-linear` had, each at 16 KiB and 64 KiB, for each of `phpImage`, `nodeImage` and `namesNodeImage`: 123 measures. `officialImage` refuses over 64 KiB before reading, so n cannot be larger than 16 KiB; repeating the call is what makes a short sample long enough. No shape was taken out.
- **Lock shapes:** the 8 inputs `gate-reader-linear` had, each grown by what grows on it, plus 3 grown by the number of keys: one key from 1 MiB to 4 MiB (3), 1,000 keys from 1,024 characters to 4,096 (5), and 250 keys of 4,096 characters to 1,000 (3). `lockKey` is now timed alone, over all the keys of a lock; it was 10 rounds plus reading the lock before. A key's length and the number of keys need separate rows: on the old expression only the first gave a high ratio (below).

Limits that remain, none of which decides what is linear: 5 s (Dockerfile) and 30 s (lock) for a sample, under Node's VM, so a backtracking expression fails and does not hang; and 15 s for a measure, after which it stops at 3 samples at the fewest.

## On this head, in Docker (`--network none`, `--memory 4g`, Node 24.22.2), 3 runs

Runs of `vitest run --project node packages/cli/test/dockerfile-check.test.ts -t "gate-reader-scaling-ratio|lock-key-many-deps"`:

| Run | Tests | Failed | Seconds | Highest of the 134 under the line (123 + 11) |
|---|---|---|---|---|
| 1 | 57 | 0 | 51.51 | 6.00 `backslash-newline pairs, nodeImage` |
| 2 | 57 | 0 | 51.45 | 6.10 `a backslash and CRLF, many times, nodeImage` |
| 3 | 57 | 0 | 51.32 | 6.77 `line feeds, COPY and spaces, namesNodeImage` |

That row of run 3 was 5.30 at its lowest over the 3 runs, the widest spread seen in the rows looked at; 8 was not reached. The three named here are shapes of many short lines. Why they go over 4 was not looked into.

| Measure | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Control: a scan of 8,000, then 32,000 | 3.99 | 4.02 | 4.06 |
| Control: a scan of each prefix of 2,000, then 8,000 (n²) | 15.75 | 15.84 | 15.69 |
| `lock-key-many-deps`: `packageLockInputs`, 200 dependencies, key of 1,019, then 4,034 characters | 13.57 | 13.51 | 13.49 |
| `lock-key-many-deps`: `resolveFrom` alone, the same keys | 14.30 | 14.24 | 14.38 |
| `lock-key-many-deps`: `packageLockInputs`, key of 4,034 characters, 50 dependencies, then 200 | 4.00 | 4.03 | 3.98 |

So on this shape `packageLockInputs` is quadratic in a key's length and grows with the number of dependencies about as that number does, and `resolveFrom` alone grows as much (a measure, where #258's record read it from the code). 657 to 665 ms at 200 dependencies is 3.3 ms a dependency, and #258's 37,105 ms at 10,000 is 3.7. This PR does not fix it. The two tests that say "about 16" hold the ratio from 8 up to 32 and fail when it is fixed: with `resolveFrom` changed in a copy to look in one place only, they gave 1.63 and 3.82 and failed, and the third gave 3.61 and passed. That change is not a fix, and it was not kept.

## Red: on the readers from before #258

The test file of this head, on php.ts, node.ts and judge.ts of d42e172, the same container (`Tests 18 failed | 39 passed | 133 skipped`, 516.64 s):

| Shape | Ratio, or what stopped it |
|---|---|
| `line feeds`, `phpImage` | 15.83 (227 and 3,588 ms) |
| `CRLF pairs`, `phpImage` | 16.03 |
| `lines of a space`, `phpImage` | 15.97 |
| `COPY and spaces`, `phpImage` | 16.18 |
| `line feeds, COPY and spaces`; `line feeds, RUN and spaces` | the 5 s guard |
| `COPY, tabs and spaces`, `phpImage` | 15.84 |
| `RUN and spaces`, `phpImage` | 15.63 |
| `a run of carriage returns`, `phpImage` | 16.04 |
| `a run of carriage returns, then a letter`, `phpImage` | 15.87 |
| `two carriage returns and a line feed, many times`, `phpImage` | 16.26 |
| `lockEntries`, one key; the same, extraneous; `lockExtraneous`, extraneous | the 30 s guard |
| `lockEntries`, 1,000 extraneous keys, 1,024 then 4,096 characters | 12.70 (38 and 480 ms) |
| `lockExtraneous`, the same | 12.93 (37 and 476 ms) |
| `lockKey`, the same | 13.74 |
| `packageLockInputs`, the same | 12.80 (747 and 9,565 ms) |

A test stops at its first reader that fails, so `phpImage` stands for the shape here. Not failed there: `lockEntries` on 1,000 install paths (3.37), and the three rows grown by the number of keys, 250 to 1,000 (3.98, 4.01, 4.01), as the old expression's time was in a key's length. `packageLockInputs` took 9,565 ms at 1,000 keys on that code.

The test file of main 728fcf1, on the same old readers, failed 16 of `gate-reader-linear`'s 49: the same 11 Dockerfile shapes, the 3 of one key, `lockKey` and `packageLockInputs`. So the ratio fails every shape the limits failed, and 2 they passed, `lockEntries` and `lockExtraneous` on 1,000 keys, at 480 ms under the 1 s limit.

## CI

The same tests' 3 runs on GitHub's runner are in this PR's description, with the ratios from each run's log (`scaling ratios:`, printed once at the end of the file).
