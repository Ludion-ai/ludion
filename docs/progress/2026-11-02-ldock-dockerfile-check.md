# 2026-11-02 — LDOCK: the Dockerfile check reads a file as BuildKit does, and a lock key has a limit

**Lane LDOCK**, from main d42e172, after a first-principles audit reported forms that passed the check and readers over linear time. Mistake: docs/mistakes/2026-11-02-dockerfile-check-not-as-buildkit-reads.md.

## What changed

- packages/cli/src/security/php.ts: `officialImage` reads through `instructions` (BuildKit's order) and `reachesOutside`, in place of the expressions over the whole file. Messages and their order are as before, with one new message for a carriage return, U+2028 or U+2029 inside a line.
- packages/cli/src/security/node.ts: `namesNodeImage` reads the same whitespace, leaves comments out and joins continuations.
- packages/cli/src/security/judge.ts: `lockKey` refuses a key over 4,096 characters without repeating it; `LOCK_PATH` is an expression with one way to match any key, and the same answers.
- packages/cli/test/dockerfile-check.test.ts (new, 122 tests). README.md and docs/status.md are not changed: "offline" in README.md's line 175 and docs/status.md's line 18 now matches what the check holds, and the check only refuses more.

## Red, then green (Docker, `--network none`, `--memory 4g`, Node 24.22.2)

The same test file on main's php.ts, node.ts and judge.ts, then on this PR's:

| Tests with this in the name | Old: failed / all | New: failed / all |
|---|---|---|
| `dockerfile-check-u0085` | 9 / 10 | 0 / 10 |
| `dockerfile-check-backslash-space` | 9 / 11 | 0 / 11 |
| `dockerfile-check-flags-and-directives` | 7 / 13 | 0 / 13 |
| `dockerfile-check-across-lines` | 4 / 11 | 0 / 11 |
| `dockerfile-check-from-on-the-next-line` | 1 / 1 | 0 / 1 |
| `dockerfile-check-names-node` | 6 / 9 | 0 / 9 |
| `gate-reader-linear` | 12 / 39 | 0 / 39 |
| the file | 51 / 122 | 0 / 122 |

A test that passes on the old code is a form it already refused, kept so the new reader cannot lose it; across-lines also fails on the old code where it refused with another message. Forms refused, for each of the two images: 45, plus FROM alone (one test of 3 cases). Of the audit's eight forms, each fails on the old code.

With this PR: `tsc` exit 0, `npm run build` exit 0, `vitest run --project node` 2,060 passed, 25 skipped (they need Docker; CI runs them), in a container with git and no network.

Mutations of the three files, each run against dockerfile-check.test.ts, security.test.ts and node-image.test.ts: 42 of 42 failed a test. Three were missed at first. `if (comment) continue;` changed nothing, as a comment's first word matches no instruction, so the line was taken out and is not among the 42; the case of RUN's flag, and `namesNodeImage` reading only the joined text, had no test, so one was added for each.

## Nothing refused before is taken now

main's php.ts and node.ts were compared with these in Docker, on every sequence of up to 3 of 38 pieces in four places round one FROM, and 3,000,000 random sequences of 4 to 13 pieces (fixed seed), 3,225,420 files in all:

| | Files |
|---|---|
| Both take, at the same place in the file | 1,493,769 |
| Both take, at another place | 0 |
| Both refuse | 407,879 |
| New takes, old refused | 0 |
| Old took, new refuses | 1,323,772 |

The old-took row by reason: 1,246,289 for a carriage return or separator inside a line; 39,341 for a directive or continuation; 28,318 for ADD, COPY or RUN; 9,820 for not having one FROM stage as read now; 4 for `FROM` with the image on the next line. Pieces were chosen to hit the rules, so these shares say nothing about real Dockerfiles. `namesNodeImage`: never lost a file the old one found; found 63 more. The comparison script was not committed; the set the new check takes on 43,275 of these files is pinned by a digest in the test.

## Times (the same container, one run each)

| Input | Old | New |
|---|---|---|
| FROM, 4,000 line feeds, COPY, 4,000 spaces, x (8 KiB; cubic) | 21,013 ms | 0.14 ms |
| The same with 2,000 of each | 2,661 ms | 0.85 ms |
| The same with RUN, 4,000 of each | 22,364 ms | not run |
| The same with COPY, 32,000 of each (64 KiB) | not run | 1.50 ms |
| The same with RUN, 32,000 of each (64 KiB) | not run | 1.42 ms |
| 65,536 line feeds | 3,561 ms | 3.79 ms |
| `lockEntries`, one key of 1 MiB | 28,986 ms | 0.17 ms (refused for its length) |
| `lockEntries`, one key of 256 KiB | 1,799 ms | 0.06 ms |
| `lockEntries`, one key of 4,096 characters | 0.92 ms | 0.48 ms |
| `lockEntries`, one key in a 4 MiB lock | not run | 0.8 ms |

`gate-reader-linear` holds these under limits Node's VM enforces: 50 ms for each of phpImage, nodeImage and namesNodeImage on 32 inputs of up to 64 KiB, and 1 s on a 4 MiB lock. A length limit alone was not enough: `packageLockInputs` on 1,000 extraneous keys of 4,096 characters, each under the limit, went over 1 s in all 3 tries with the old expression, and passes with the new. Measured and not changed: `packageLockInputs` on 1,000 valid install paths of about 4,096 characters (4 MiB), each with one dependency, took 3,971 and 3,867 ms. That the time is in `resolveFrom` is read from the code, not profiled.

## npm corpus

434 locks, 5,350 keys; the longest has 93 characters. `lockKey`'s answers and `lockEntries`'s result on every lock, and `lockKey`'s answers on 299,593 short keys, plain and marked extraneous, have the same digests as main's code.

## With BuildKit

Docker 29.9.2, buildx v0.38.1, `docker build --network=none --pull=false --no-cache --output type=cacheonly -`, the Dockerfile on standard input and no context:

| Form | What `docker build` did |
|---|---|
| U+0085 before `ADD https://ludion.ai/robots.txt /r` | ran the ADD, exit 0 |
| `AD\ `, then `D https://…` | ran the ADD, exit 0 |
| `AD\`, a space, a tab and a space, then `D https://…` | ran the ADD, exit 0 |
| U+0085 before `` # escape=` ``, then `` AD` `` and `D https://…` | ran the ADD, exit 0 |
| No-break space before ADD | ran the ADD, exit 0 |
| U+0085 before a second FROM of a digest-pinned alpine, then RUN | built the second stage, printed 3.20.10, exit 0 |
| `FR\ `, then `OM` and the same alpine, then RUN | built the second stage, printed 3.20.10, exit 0 |
| U+0085 before `COPY --from=` a name that does not exist | went to resolve the name |
| `COPY --fr"om"=localhost:1/none:nope`, and `--fr\om=` | went to resolve localhost:1, so the flag was read as --from |
| `RUN --net"work"=ldockbad true` | `invalid network mode "ldockbad"`, so the flag was read as --network |
| `COPY --nosuch=x` (control) | `unknown flag: --nosuch` |
| `//syntax=localhost:1/none:nope`, `# syntax=` the same, and `{"syntax":"localhost:1/none:nope"}` | each went to resolve localhost:1 |
| A carriage return inside a LABEL line, before ADD | read as one line, did not run the ADD, exit 1 |
| ADD, U+0085, then the URL | `unknown instruction`, exit 1 |
| A comment ending in a backslash and a space, then LABEL | exit 0 |

A tab alone after the backslash was not built: the shell's printf gave a backslash and the letter t, which BuildKit refused as an unknown instruction. The mixed form above has a tab between two spaces. The check refuses both.

The form with U+0085 before `COPY --from=` sent its made-up name to Docker Hub, which answered that no such repository exists. No build here showed that a form the check takes stays offline; what the tests hold is that the check takes none of the forms above.
