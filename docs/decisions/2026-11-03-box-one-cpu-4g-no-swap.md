# 2026-11-03 — The box npm projects' code runs in: one CPU, 4 GiB, no swap (LBOX)

Decided 2026-11-02 23:37 JST. Written here on 2026-11-03, in the PR that makes it so. No gate's numeric criterion and no wait changes.

## The decision

Every box that runs an npm project's code, validation's and gate 3's, is:

`--cpus 1 --memory 4g --memory-swap 4g`

- It is the same in the product, in LSAMPLE and in C4.
- `--memory-swap` equal to `--memory` turns swap off. The CPU stays at the 1 it was.
- The value is in one place, `NPM_BOX_MEMORY` in packages/sandbox/src/docker.ts. It is no argument: a caller cannot change it.
- Composer's and Maven's boxes do not change, since they are outside v1's scope. Nor does the box of an official image's patch (patch.ts), which is neither of the two boxes this decision names: all of these stay at `--cpus 1 --memory 512m`.
- No other part of the isolation changes: no network, a read-only root, no capabilities, a non-root user, the process limit and the /tmp of 64 MiB.
- Gate 3 runs its boxes in order, one at a time (`once` in packages/cli/src/security/gate3.ts). The product keeps to this.
- The earlier figure of a box of 4 vCPU and 14 GB is withdrawn. It was a number nobody had measured.

The decision as written, word for word:

> npm のプロジェクトのコードを動かす箱は、全部これにする（今の検証の箱と gate 3 の箱）。製品、LSAMPLE、C4 で同じ。`--memory 4g --memory-swap 4g`（swap を止める）。CPU は今の 1 のまま。Composer と Maven の箱は変えない（v1 の範囲の外）。

> gate 3 は箱を順に 1 つずつ動かす（gate3.ts の該当行）。製品はこれを守る。

> 以前の「箱 4 vCPU・14 GB」は取り下げ。測っていない数だった。

## Why 4 GiB

A small, ordinary application passes at 1 GiB with no swap, 3 of 3 runs (`memory.peak` 948 to 1,004 MB, page cache included). A real project is heavier, which is a guess and has not been measured. So the box takes four times that as room.

GitHub's standard runners have 2 vCPU and 8 GB on a private repository, and 4 vCPU and 16 GB on a public one. A box of 4 GiB, one at a time, fits on a private repository's runner too.

## When this is looked at again

If, in LSAMPLE's trial of Next.js projects, more than 10% run out of what the box allows on the old version at 4 GiB (`oom_kill` of 1 or more, a heap running out, or ENOSPC), this size is looked at again.

## What the result records

Each run's result has the value of `/sys/fs/cgroup/memory.swap.max` in the box, as the box says it: `0` with swap off, or `max`, or another number. When it cannot be read, or holds anything else, it says `unknown`, and no number is made up. Nothing decides on it.

- Gate 3: `memory_swap_max` in each run, read by the driver in the same box.
- Validation (npm): `baseline_memory_swap_max` and `candidate_memory_swap_max` in the receipt. They are read in a box of their own, with the same flags and the same image as the test, just before it, because the test is the project's own command and is not changed to read it. So they say what a box of these flags has, not what that one run's box had.

A candidate's code runs in gate 3's box, so like every figure printed there this one is what the box printed (the Limits in docs/decisions/2026-11-02-gate-3-type-definition.md).

## What this is not

- A box of 4 GiB has not been run on a real project: the figures above are for the small application at 1 GiB. Gate 3's measurements so far (docs/progress/2026-11-02-lg3-gate-3-type.md) were at 512 MiB with swap, and they stay as they were measured.
- It raises a resource limit, so the PR is a protected PR that the owner merges. Turning swap off is the stricter side; 4 GiB is the looser one.

## Checks

`packages/sandbox/test/docker.test.ts`: `gate3-box-has-no-swap`, `box-size-is-one-number`, and that the other boxes are unchanged. `packages/cli/test/gate3.test.ts`: `gate3-result-records-swap-max`, `gate3-boxes-one-at-a-time`. `packages/cli/test/dependencies.test.ts`: `validation-result-records-swap-max`.
