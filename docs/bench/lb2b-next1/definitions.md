# LB2b-next(1): the scheduled workflow's check job — definitions (2026-11-01)

Committed before the code, the tests or any run, so that no definition is loosened after a result is seen (git history shows the order). These are definitions of how the check decides and how it is tested; nothing here changes a gate, the wait table or a rule of CLAUDE.md. Starting point: main b803f2b0e59b2310e120f3164cc3376ad0d44925.

What it builds: the scheduled workflow's template (action/patch-workflow.yml) gets a first job, `check`, which decides before Docker whether this run has anything to do. It comes from the prototype that ran in a private trial repository (docs/bench/2026-10-31-lb2b2/trial-files, `mode: check`, action/check.sh at 6162b79), with three changes:

1. it looks only at the ecosystem of the project's saved policy (ludion.security.json), the one `patch` fixes;
2. a fix whose wait cannot have ended yet does not start `patch` (the lower bound t*, below);
3. a fix that is not new, and that no open Ludion PR fixes, starts `patch` only in the 12-hour slots that double (below).

The state of earlier runs (a state ref), notification and the ignore list are not part of this PR; neither are the hourly cron and the push trigger. The template keeps `23 */6 * * *`.

## 1. What the check reads

- (i) the run's commit, checked out without credentials, and its committer time C (`git log -1 --format=%cI`);
- (ii) the live answers of `ludion check` on that commit: `ludion scan` of the policy's ecosystem only, and the facts below (OSV records by id, the npm registry or Packagist, CISA's KEV catalog and FIRST's EPSS list, both downloaded whole);
- (iii) the repository's open PRs, the compare API and their heads' files (tarball through the API), as in the prototype.

It reads no earlier run's artifact, receipt or record: the job holds `contents: read` and `pull-requests: read` only (no `actions` permission). Every request sends only what the scan already sends: package names and versions, advisory ids back to OSV, and whole-list downloads.

## 2. The policy's ecosystem only

- E = the policy's ecosystem: `ecosystem` in ludion.security.json, or `php` for a Dockerfile policy without it, as `patch` reads it (project.ts, readConfig). A policy that cannot be read: undecided.
- The scan is `scanProject(root, E)`: for npm, composer or maven only that lockfile; for php or node only the policy's Dockerfile. No other inventory in the folder is scanned, so none of them can make a run's answer `work=true`.
- The other inventories present (npm, composer or maven files, a Dockerfile naming php or node when E is not that, a read-only reader's files) are named in one line of the job summary ("not checked by this workflow"), and do not count in the answer.
- **maven:** `ludion scan` of a Maven project resolves its dependency graph in Docker, which the check does not run. A maven policy is undecided: `work=true`, every run, as before.

## 3. Keys

As in the prototype's definitions (docs/decisions/2026-10-31-lb2b2-trial-definitions.md, item 2), with the image case corrected:

- An image policy (php, node) has the key `php` or `node` when the scan has a candidate (`candidate` not null), whatever its status: a move with no newer security release, whose wait has ended, is work for `patch` too (scan exits 0 for it since LSCANX, so the prototype's "exit 0 → nothing to do" would have skipped it).
- A dependency policy has the key `<E>:<package name>` for each finding of the scan (one key per package, however many advisories or versions).
- Undecided, so `work=true`: the scan throws; its check has an `error` (a Docker Hub stop included, whatever security releases it keeps); a dependency scan with status `incomplete`; any answer of another shape.

## 4. The lower bound t* of a wait's end

For a key, t* is a time before which `patch` cannot apply its fix. A key with t* later than now waits; it does not start `patch`.

- **Image, status `wait`:** t* = the scan's `wait_until`. It is exact: `patch` reads the same scan and makes no receipt while the image waits (patch.ts). After it, t* stays `wait_until` (the scan still gives it), which is now in the past.
- **npm:** t* = P + W(u).
  - P = the earliest publish time, in the npm registry's `time`, of the versions the fix may take: every semver version of the package that is not lower than the smallest version the scan's plan moves it to (the smallest fixed version; a later one when the smallest cannot be used, next-fix.ts, which only takes later versions). A backport published before the smallest fixed version counts with its own, earlier time.
  - W(u) = WAIT_HOURS[u] (judge.ts: exploited 12, high 24, normal 72).
  - u = the most urgent of **every** finding of the scan, not only this package's: exploited when a CVE alias of any finding's advisory is in KEV; else high when any advisory's OSV `database_specific.severity` is CRITICAL or the highest EPSS score of its CVE aliases is at least 0.1; else normal. These are the judge's own rules and sources (urgencyOf, gatherFacts).
  - **Unknown, so 12 hours:** when any advisory record, KEV or the EPSS list cannot be read, u is not known and W = 12, the table's shortest wait.
  - **No bound** (the key does not wait): the package has no planned change, its registry document cannot be read, no version qualifies, or one of them has no publish time.
  - **Why t* is a lower bound of the judge's wait_until:** the judge counts the wait from the newest publish among the changed versions, which includes the version the fix takes (so it is at least P); its urgency counts the advisories that the change fixes, which are findings of this scan (so it is no more urgent than u); and an uncomparable provenance (24 hours for exploited), an extended wait and a stricter project wait only make the wait longer.
- **composer, and image moves that do not wait:** `patch` has no wait for them: no bound.

## 5. Doubling for a fix that is not new

A key that no open Ludion PR fixes and that does not wait (no t*, or t* not later than now) is either new or one that `patch` has already tried and that failed, waited past t* or stopped. Without an earlier run's state the check cannot tell them apart, so it counts from the last time anything about the fix changed:

- **Anchor** a = the latest of: t* (when there is one), C, and F, where F is the newest time of the facts the fix rests on:
  - npm: the OSV `modified` time of every advisory of the package's findings, and the registry document's `time.modified` (a new version, a deprecation or an unpublish changes it);
  - composer: the OSV `modified` time of every advisory of the package's findings, and the newest release time Packagist lists for the package; an advisory OSV has no record of (a Packagist-only id) is unknown;
  - image: the end of the release day of every newer security release the scan lists, and, when the scan gives `wait_until`, the end of the candidate's release day (`wait_until` − 72 hours).
  - Unknown, so a = now: any of these cannot be read or is not a time. The fix is then due.
- **Slots:** m = ⌊(now − a) / 12 hours⌋. The key is **due** when a is later than now, or m is 0, or m is a power of two (1, 2, 4, 8, …): the slots [0, 36), [48, 60), [96, 108), [192, 204) hours after a, and so on. Otherwise it is quiet in this run.
- **Why 12 hours and time, not a count of runs:** GitHub does not start every scheduled run. Measured gaps between scheduled runs were 4.82–7.21 hours (Ludion-ai/ludion-shadow, hourly cron) and 3.46–7.30 hours (the private trial, hourly cron); docs/decisions/2026-10-31-scheduled-run-hourly.md and the audit of 2026-11-01. A slot shorter than the gaps would be missed; 12 hours is longer than every gap measured. Counting runs needs the earlier runs' state, which is the next PR's.
- **What this costs, stated:** a change the anchor cannot see waits for the next due slot. Known: a fix whose wait the judge extends beyond t* (another publisher, uncomparable provenance, a stricter project wait) is applied at the first due slot after the true end, up to about (true end − t*) later; a commit whose committer time is older than its push; an OSV change that does not move `modified`. A run on a due slot that GitHub does not start is lost until the next due slot.
- The same decision is made on `schedule` and on `workflow_dispatch`.

## 6. The answer

- `work=true` when the check is undecided (sections 2 and 3), when the bundled CLI or GitHub's API fails in any way, or when some key is due and is not covered by an open Ludion PR. Covered is the prototype's rule B unchanged: an open PR from this repository, head ref starting `ludion/`, opened by `github-actions[bot]`, whose head is this commit's folder plus its change (compare API), and whose head's keys (`ludion check --keys-only` on the head's folder, which reads no facts) do not include the key.
- `work=false` otherwise: no key; or every key waits (t* later than now), is quiet (section 5) or is covered.
- The job summary and the log give the answer and, per key, why: covered by #N, waits until t*, quiet until the next due slot (its time), or due.
- When the check job fails, `patch` runs (`!cancelled() && needs.check.outputs.work != 'false'`).

## 7. Tests (written first; each must fail on b803f2b)

In packages/cli/test, run in Docker (node:24 pinned by digest, a clone in the volume ludion-lb2bn1-w, `npm ci --ignore-scripts` with the network, everything after it with `--network none`, no Docker socket, `--memory 4g`). Fetch, KEV, EPSS, OSV, the registry and `gh` are stand-ins; no test reaches the network.

- T1 (audit, item 2): an npm policy with `FROM node:22-alpine` in the folder's Dockerfile and a lodash finding fixed by an open Ludion PR → `work=false`; the node image is not scanned.
- T2: an npm policy with a composer.lock that has a finding → `work=false` when the npm side has nothing, and the summary names composer.lock as not checked.
- T3: npm t*: normal urgency, the fix published 10 hours ago → waits (t* = publish + 72 h); exploited (KEV) → due at 12 h; KEV unreadable → 12 h; a later version published earlier than the smallest fixed (backport) → P is the earlier time; a KEV entry on another package's finding makes this one's wait 12 h too.
- T4: t* is never later than the judge's wait_until for the same change (judge() on the facts the stand-ins give, for normal, high, exploited, an extended wait and a stricter project wait).
- T5: an image `wait` → waits until `wait_until`; after it → due; a non-security move whose wait has ended is a key (the prototype's exit-0 case).
- T6: doubling: m = 0, 1, 2, 4, 8 due; 3, 5, 6, 7, 9 quiet; a later commit time, a newer OSV `modified` or a newer registry `time.modified` moves the anchor and makes the key due; an unreadable fact makes it due.
- T7: undecided → `work=true`: a maven policy, a scan error, an incomplete scan, an unreadable policy, the CLI failing.
- T8: action/check.sh with stand-in `node` and `gh`: work=false without listing PRs when no key is due; work=true when a due key is not covered; work=false when every due key is covered; work=true when gh fails.
- T9: the template and action.yml: the check job has `contents: read` and `pull-requests: read` only, no secret; patch `needs: check` with `!cancelled() && needs.check.outputs.work != 'false'`; the cron is unchanged; every action is pinned by a full SHA; start.sh accepts mode check on schedule and workflow_dispatch only.

## Not done here

- No run in a GitHub repository: the action has no release commit with its bundle, and the template keeps a placeholder SHA. A trial, when one is run, is by `workflow_dispatch` only; no scheduled workflow is added anywhere.
- The state ref, the doubling of notifications, the ignore list, the hourly cron, the push trigger and the time since the previous run: later PRs.
