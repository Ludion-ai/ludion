# 2026-11-01 (LDGLAT) — How long a Debian security fix takes to reach the official image tags, measured in the past. Definitions fixed before counting

LDGLAT measures, for Debian bookworm, the time from an OS-package security fix being published to an official image tag that contains it, in two stages: the fix to the base image (debian:bookworm-slim, debian:bookworm), and the base image to the official tag (node, php). It also measures how often these images are rebuilt. The definition of LDG (updating to a same-tag rebuild, docs/decisions/2026-10-31-same-tag-rebuilds-in-scope.md), and where its wait starts counting, waits for these numbers.

**This is a measurement. It changes no product code**, gate, wait table, CLAUDE.md, docs/design.md or docs/status.md. It sets no wait for LDG.

Source of the method: ludion-ops#1, the brain's comment 6542470518, item 4, and the audit's comment 6542250801, item 4 (the unit "OS fix × base image", the two stages, Debian measured in the past from docker-library/repo-info and snapshot.debian.org, Alpine written as a range, the rebuild-interval distribution, a separate workflow for the forward record). The brain's earlier comment 6542062338, 3 (start at the DSA/DLA date) is replaced there by the audit's plan, and so here.

This entry is committed before any number below is counted. What had been looked at before it: the format of one repo-info file (repos/debian/local/bookworm-slim.md at repo-info 2427e432ef7036b8bcc918aa1703b960a3d6dea7); the list of bookworm file names under repos/debian, repos/node, repos/php and repos/buildpack-deps; the number of commits since 2025-10-01 to two files (25 and 36) and their three latest commit times; the form of three snapshot.debian.org answers for openssl 3.0.17-1~deb12u3; and the `FROM` lines of eight Dockerfiles (below). No start, end, interval or median was computed. A later change is a new entry with its reason.

## 1. Sources (read only inside a container with no credentials)

- **docker-library/repo-info**, cloned once with `--filter=blob:none --no-checkout` into a Docker volume, at commit `2427e432ef7036b8bcc918aa1703b960a3d6dea7` (committed 2026-10-31T14:59:06Z). Its `repos/<image>/local/<tag>.md` files list, for the amd64 image of a tag, its Image ID, its `Created` time and every dpkg source package with its version (`### \`dpkg\` source package: \`<name>=<version>\``) and binary packages. A commit is made when a scan finds the content changed. Nothing of repo-info is checked out or kept on the host; only the fields named here are extracted, to tab-separated files.
- **snapshot.debian.org**, its machine-readable API (`/mr/package/<source>/`, `/mr/package/<source>/<version>/binfiles/<binary>/<version>?fileinfo=1`, `/mr/package/<source>/<version>/srcfiles?fileinfo=1`). Its `first_seen` is the time of the first snapshot of an archive in which a file was present. Only Debian package names and versions are sent. The JSON answers are kept as they are.
- No image is pulled or run. Nothing about any project is sent anywhere.

The containers: `ludion-l9-node24-git` (local, node 24.22.1 on Debian 12, git 2.39.5, dpkg 1.21.23), non-root (uid 1000), `--memory` 2g, no host directory mounted except this folder's `scripts/` read-only and an output folder; Docker volume `ludion-ldglat-w`.

## 2. The images

Parents as their Dockerfiles say on 2026-11-01 (read in a container from raw.githubusercontent.com):

| Base image (stage 1) | Official tags (stage 2) | Parent chain |
|---|---|---|
| `debian:bookworm-slim` | `node:22-bookworm-slim`, `node:24-bookworm-slim`, `php:8.2-cli-bookworm`, `php:8.3-cli-bookworm`, `php:8.4-cli-bookworm`, `php:8.4-fpm-bookworm`, `php:8.4-apache-bookworm`, `php:8.5-cli-bookworm` | `FROM debian:bookworm-slim` |
| `debian:bookworm` | `node:22-bookworm`, `node:24-bookworm` | `FROM buildpack-deps:bookworm` ← `buildpack-deps:bookworm-scm` ← `buildpack-deps:bookworm-curl` ← `debian:bookworm`; the three buildpack-deps hops are inside stage 2 |

`buildpack-deps:bookworm` is read for its rebuild intervals only. Not counted, and why: alias tags (`php:8.4-bookworm` is the same image as `8.4-cli-bookworm`; `8-…`, `lts-…`, `current-…` and full-version tags such as `8.4.27-cli-bookworm` duplicate a line tag); `zts` variants; node 20 (end of life 2026-04-30) and node's odd lines; the dated debian tags (`bookworm-20261027-slim`), which are never rebuilt; trixie and Alpine (section 8); other architectures (repo-info's `local` files are amd64 only).

## 3. The unit and the fixes

**Unit: one Debian security fix × one base image.** A *fix* is a version V of a source package S that was uploaded to Debian's security archive for bookworm. Its unit with base image B exists when B lists S at the start (section 4) at a version lower than V.

The fixes are found from the archive, not from the images, so a fix that never reached an image is still counted:

1. S ranges over every source package that any commit of B's file lists from 2025-11-01 to the data end.
2. The candidate versions of S are those `/mr/package/S/` lists that contain `deb12u`, together with every version of S that any counted file (section 2) lists at any time.
3. A candidate is a fix when its amd64 binary (section 4) has a file in the archive `debian-security`. A candidate with none is not a security-archive upload (a point release, proposed-updates or another release) and is left out, counted by reason.
4. The fix is counted when its start (section 4) is in **[2025-11-01T00:00:00Z, data end)**, the data end being repo-info's commit time above, 2026-10-31T14:59:06Z.

**Secondary units: one fix × one official tag**, for a source package that the tag lists at the start and its base image does not (php adds packages such as curl and libxml2 itself). These have no stage 1. They are shown apart and are not part of the unit counts.

Version order is dpkg's (`dpkg --compare-versions`, dpkg 1.21.23 in the container).

## 4. Start and ends

- **Start t0:** the earliest `first_seen` in archive `debian-security` of the amd64 `.deb` of V's binary package (the first binary package B's file lists for S at the start; an `_all.deb` when that binary is architecture-independent). When that binary has no file there, the earliest `first_seen` in `debian-security` of V's `.dsc` (marked `src`). snapshot's resolution is its run interval: a file can have been published up to one snapshot run before `first_seen`.
- **Stage 1 end t1:** the commit time of the first commit of B's file with commit time ≥ t0 whose listing has S at a version ≥ V. Recorded with it: that listing's `Created` (for debian images, the archive snapshot time the image was built from) as a lower bound.
- **Stage 2 end t2,** for each official tag T on B: the commit time of the first commit of T's file with commit time ≥ t0 whose listing has S at a version ≥ V.
- **Times:** stage 1 = t1 − t0; stage 2 = t2 − t1; total = t2 − t0. A negative stage 2 (T's scan seen before B's) is kept and counted as such, not set to zero.
- **Resolution of the ends:** a commit time is when repo-info's scan saw the change, so the image may have been pushed up to one scan interval earlier. The scan interval is not in the data (a commit is made only on a change), so it is reported as 不明, with the commit times' hours of day shown.
- **Not reached by the data end:** no such commit by the data end. Shown with its elapsed time (data end − t0) as a lower bound, counted apart. **Dropped:** a later listing of B (or T) no longer has S before reaching V; counted apart. A tag whose file has no commit at or before t0 has no unit for that fix (the tag did not exist yet).

## 5. What is reported

- Counts: candidates, fixes, units, secondary units, and each left-out reason.
- **Stage 1 per unit:** count, minimum, 10th percentile, median, 90th percentile, maximum, in hours, for each base image, for those reached; the number not reached and their lower bounds. Also the median with the not-reached counted as larger than every reached value.
- **Stage 2 and total per tag:** the same, per tag and over all tags. Within one unit, the tags are repetitions, not independent samples, so over all tags the summary is also given as the median, over units, of each unit's median across its tags.
- **Independent events:** the number of distinct base-image commits (distinct t1) that ended the units, and how many units each ended.
- **Rebuild intervals,** from 2025-11-01 to the data end, for each file in section 2 and `buildpack-deps:bookworm`: the times between consecutive commits whose Image ID differs (a new digest), and separately those whose dpkg listing differs; count, minimum, 10th percentile, median, 90th percentile, maximum in hours, and the shares under 24 h and under 72 h.

Percentiles are nearest-rank. Every number is printed by the analysis script and copied from its output; the raw extracted rows and API answers are in docs/bench/2026-11-01-ldglat/raw/.

## 6. What this does not measure

The time to a user's project (that is Ludion's part, LDG); arm64 and other architectures; Debian fixes outside the security archive (point releases); how severe a fix is (every security-archive upload counts the same: DSA, DLA and others are not told apart); Alpine and trixie.

## 7. Where the LDG wait starts (not decided here)

The audit names two choices that keep a rebuild from restarting LDG's wait: count from the first digest that contains the fixed version, or choose the newest digest older than the wait. The rebuild-interval distribution in section 5 is for that choice. This entry does not make it.

## 8. Designed, not built: Alpine, and the forward hourly record

No workflow file is written by this lane (.github/ is a protected path, and other repositories such as Ludion-ai/ludion-shadow are not touched).

- **Alpine, as a range.** Start lower bound: the commit time, in aports (read in a container), of the commit that set the fixed `pkgver`/`pkgrel` in the release branch (for example `3.22-stable`). Start upper bound: the first hourly APKINDEX download (whole `APKINDEX.tar.gz` of `main` and `community`, x86_64, nothing sent) in which the fixed version appears. APKINDEX's `t:` (build time) lies between them and is recorded. Every fetch time is kept, so the start is written as [the last time it was absent, the first time it was present]. The end is read as for Debian, from `/lib/apk/db/installed` through repo-info's `local` files or the image's layers, in a container, the image not run.
- **Forward hourly record** (for both, to raise the resolution of the ends above one scan): a workflow of its own file, not a step of shadow.yml, in its own `concurrency` group, so that a Docker Hub or APKINDEX failure cannot stop shadow.yml's `next` job and condition (b)'s chain. Each hour it records, for the newest tag of each line in section 2 and the Alpine ones, the tag's digest and `tag_last_pushed` (tag names only are sent) and the APKINDEX files, with the time of every fetch. GitHub's schedule can be hours late (docs/status.md), so the resolution is what the fetch times show, not assumed to be an hour.

## When it takes effect

From its commit. It decides only how this measurement counts.
