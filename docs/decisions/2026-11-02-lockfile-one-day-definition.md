# 2026-11-02 — The lockfile one-day measurement: the definition, fixed before measuring

LLOCK counts which lockfiles public npm projects keep at their root. It is material for the line 「lockfile は 1 日の測定で一番多いものに決める」 in docs/decisions/2026-11-02-definition-of-complete-final.md (「範囲：npm だけ」). It changes no code, no gate and no wait. This record was committed and pushed before any request about a lockfile or a package.json was sent. It is not changed after the result is seen; a correction is a new, dated section here, saying what had been seen by then.

**Why this lane exists.** docs/status.md at main 5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94: line 59 (C10, "LV0's strata"), line 72 (the scope table's heading, "decided once LV0's numbers are in"), line 76 ("npm (package-lock.json)") and line 77 ("npm (pnpm, yarn and bun locks) | Not read | In if LV0 shows many").

**What had been seen when this was written.** Event counts per type in GH Archive hours (docs/bench/lockfile-one-day/archive-scan.jsonl, scripts/probe-types.mjs), the field names of two hours (scripts/probe-schema.mjs) and one hour's ForkEvent ids (docs/bench/lockfile-one-day/boundary-evidence.json, scripts/boundary.mjs). No request had gone to raw.githubusercontent.com, and no repository's files had been read.

## 1. One departure from the brief: the day

The brief names 2026-11-01. **That day cannot be measured as written: all 24 of its GH Archive files hold 0 PushEvents** (docs/bench/lockfile-one-day/archive-scan.jsonl), so the population would be empty. The same files do hold pull request, watch and fork events. Why the PushEvents are missing is not known here. The gap comes and goes: 2026-10-26's 00 and 06 hours have them, its 12 and 18 hours do not, and 2026-10-27 to 2026-10-31 have none in the four hours looked at each day.

The day used is therefore fixed by this rule: **the latest UTC day on or before 2026-11-01 whose 24 files each hold at least one PushEvent.** That is **2026-10-25**: 26,554 to 71,105 PushEvents in each of its 24 hours in the scan. 2026-10-26 fails (hour 12 has 0). 2026-10-25 is a Sunday, as 2026-11-01 is.

Nothing else in the brief's population is changed. Other choices were looked at and refused: pull request events of 2026-11-01 would count another population, repositories that use pull requests. Several days together would not be one day. **The hourly PushEvent count on 2026-10-25 is lower than earlier in the year** (2026-06-01 hour 12: 135,957; 2026-10-25 hour 12: 66,648), so GH Archive may hold only part of that day's pushes. Whether what is missing is random is not known. This is a limit of the result.

## 2. The population

Repositories that, in the 24 GH Archive files of 2026-10-25 UTC, have at least one PushEvent to their default branch, counted once each by `repo.id`.

- **Public:** an event whose `public` is not `true` is left out and counted.
- **A branch:** `payload.ref` must start with `refs/heads/`; the rest is the branch. Other events are left out and counted.
- **The name:** the `repo.name` of the repository's latest PushEvent that day. A name that is not `owner/repo` in `[A-Za-z0-9_.-]` is left out and counted, since it cannot be asked about.
- **The default branch.** A PushEvent no longer names it (its payload has `repository_id`, `push_id`, `ref`, `head`, `before`). Two other events of that day do:
  1. **Known:** `payload.master_branch` of a CreateEvent of that repository, or `payload.forkee.default_branch` of a ForkEvent, for the fork's own id. The latest in the day counts. The repository is in the population when one of its pushes went to that branch, and left out and counted otherwise.
  2. **Not known** (no such event that day): the repository is in the population when one of its pushes went to `main` or `master`. It is left out and counted otherwise. So a repository whose default branch has another name and that had no CreateEvent or ForkEvent that day is not in the population. The count shows how many repositories this leaves out; how many of them have such a default branch is not known.
- **No other filter.** Forks and bots are not told apart and stay in. The file that is read is the default branch's at the time of the request (section 4), which can differ from what the push held.

Malformed lines in a file are counted and skipped. A file that cannot be read whole after 3 tries stops the run, since the population needs all 24.

## 3. The strata, the draw and the allocation

- **The boundary is repository id 1087451773.** At or above it: "new", made in about the last 12 months. Below it: "old". Ground: in GH Archive's file for 2025-11-01 hour 00, 558 ForkEvents give a repository made at that moment with its own id and `created_at`. The earliest, made at 2025-11-01T00:00:26Z, has the smallest id, 1087451773; the latest, at 00:59:53Z, has 1087465893 (docs/bench/lockfile-one-day/boundary-evidence.json). That file has no repository CreateEvent (`ref_type: repository`: 0), so forks are the evidence used. The brief fixes the boundary at about 2025-11-01, so it is not moved for the day of section 1; on 2026-10-25, "the last 12 months" is 11.8 months.
- **The draw.** The seed is the text `llock-2026-11-02`. Each repository's key is the SHA-256 of `llock-2026-11-02:<repo.id>`, in hexadecimal. Within a stratum, the order is by key, ascending. So the draw is random, can be repeated and owes nothing to what any request answers.
- **The allocation: 500 and 500.** Each stratum gets the first 500 repositories, in its order, for which `HEAD https://raw.githubusercontent.com/<owner>/<repo>/HEAD/package.json` answers 200. Equal shares, because the per-stratum shares are asked for and each then has about ±4.4% at most. 404 means no package.json, and the walk goes on. A deleted, emptied or now private repository also answers 404, and is not told apart. Any other answer after section 5's retry is "unknown": counted, not in the sample, and the walk goes on.

## 4. What is counted

For each of the 1,000, a HEAD to `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<file>` for each of: `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`. 200 is present, 404 is absent, anything else after the retry is unknown. Only the root is looked at, and only the default branch (`HEAD`). `npm-shrinkwrap.json` is not among the things counted, so a repository with only that counts as none.

**yarn.lock's format.** When yarn.lock is present, a GET with `Range: bytes=0-1023` reads at most its first 1,024 bytes. v1: a line that is `# yarn lockfile v1`. Berry: a line `__metadata:`. Neither: "other". A failed read: unknown. The bytes are read and dropped; only the word is kept.

**Several lockfiles in one repository are counted two ways, and neither is dropped:**

- **Each file on its own (the row that decides "the most"):** a repository with two is counted once under each, so these rows can add up to more than 100%.
- **Alone:** only that file, two or more, or none. These rows add up to 100% of the repositories whose five answers are all known.

A repository with an unknown answer leaves the denominator only of the rows it cannot be decided for, and the unknown count is given per row.

## 5. Requests

No token, no GitHub API, no cookie, no new secret. GH Archive's files are public. Requests name only a repository and a file. At most 4 at once and at most 8 per second, together. A 429, a 5xx or a failed request: wait for `Retry-After` when given (at most 15 minutes), otherwise 30 seconds, and try once more; a 429 pauses all requests for that wait. Still not answered: unknown. A redirect is not followed and counts as unknown. A request gets 20 seconds. Twenty unknown answers in a row stop the run, whose journal lets it go on from there.

**The number of requests.** The brief says about 5,000 HEADs in all, which is 1,000 × 5. Finding the 1,000 also takes one HEAD per repository walked, so the total is 5,000 plus the walk, and more than 5,000. The sample's size is fixed by the brief and is kept. A hard cap of 25,000 HEADs stops the run; the result then says how far it got. The number actually sent is reported.

Nothing is cloned. No file of another repository is run or kept on the host. All of it runs in a container of `node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413` with no credentials, no socket and no host environment, `--memory 1g`, the scripts mounted read-only, and writing only to a named Docker volume.

## 6. How the numbers are given

- **Per stratum:** k/n, the share and its 95% Wilson interval (z = 1.959964).
- **Overall:** weighted, since the allocation is not proportional. A stratum's weight W is its population size × its share of package.json among the repositories walked with a known answer, divided by the sum over both. Share = Σ W·p. Interval: Wilson on the effective n = 1 / Σ (W² / n). The uncertainty in the weights themselves is not in this interval.
- **When:** the pushes are of 2026-10-25 UTC, and the files are as raw.githubusercontent.com answered in the run; the first and last answer's times are given.
- Everything a repository's answer was is kept in docs/bench/lockfile-one-day/sample.csv and docs/bench/lockfile-one-day/screen.csv.

This measures public repositories with a push that GH Archive holds. It is not a measure of the projects of the people Ludion is to protect, and it says nothing about private repositories.
