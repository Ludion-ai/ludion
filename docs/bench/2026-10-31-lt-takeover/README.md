# LT — hijacked versions and condition 1 (2026-10-31)

Definitions: `docs/decisions/2026-10-31-lt-takeover-definitions.md`, committed and pushed (02e7c98, committed 16:20:31Z; GitHub records the branch created at 16:20:37Z) before anything was fetched. They were not changed afterwards. One flaw in them, found after the run, is under "What the definitions got wrong" below; the results are given as defined and the flaw is shown beside them.

**This is an experiment that only reads.** No product code, gate or wait changes. Whether the gate shape is good enough is the owner's decision.

## What ran

| Phase | Where | When (UTC, 2026-10-30) | Output |
| --- | --- | --- | --- |
| Scripts committed | — | 9d8d42b | `scripts/` |
| refs: registry and ecosyste.ms documents, reference lists (§2, §3, §7) | Docker | 16:25:40–16:28:14, exit 0 | `phase1.json`, `refs.log`, `repos.txt`, `commits.tsv` |
| gh: repository metadata, compare, tag commit times (§3, §5) | host, `gh api` GET only | after 16:28:14 – 16:37:43 | `gh-repos.tsv`, `gh-compare.tsv`, `gh-commit-times.tsv`, `gh.log` |
| archive: GH Archive, 529 hours (§4) | Docker | 16:38:13–17:07:15, exit 0 | `phase3.json`, `archive.log` |
| source: source diffs of the 44 tagged rows (§6) | Docker | 16:39:52–16:41:23, exit 0 | `phase4.json`, `source.log` |
| summary (§8) | Docker, no network | 17:07:37, exit 0 | `lt.json`, `run.log` |

- **Docker:** node:24, user 1000, read-only root, tmpfs `/tmp`, `--memory 3g`, no credentials, no forwarded environment. The repository at 9d8d42b (`git archive`, dependencies installed with `npm ci --ignore-scripts`) was mounted read-only. Each phase was run once; there were no reruns and no smoke runs that fed a result.
- **GH Archive:** 529 hourly files, 32.88 GB streamed and gunzipped in memory, none missing, none saved. Only the matching events were kept (per hour, in the cache volume).
- **Host:** only `git`, `gh`, `docker`, `curl -I` (four GH Archive file sizes, before the archive phase, to estimate the volume) and shell tools ran there. No node, npm, npx or python.
- **The cache volume** (`lt-cache`) and the repository volume (`lt-w`) are deleted after the run.

## Results: malicious versions (1,148)

### Condition 1, as defined (§8)

| Outcome | Rows |
| --- | --- |
| tied: tag now | 44 / 1148 (3.83%) |
| tied: tag at the time only | 0 |
| tied: provenance only | 0 |
| not tied: P names no repository | 364 / 1148 (31.71%) |
| not tied: P not obtained | 41 / 1148 (3.57%) |
| not tied: P's repository not GitHub | 24 / 1148 (2.09%) |
| not tied: P's repository not understood | 17 / 1148 (1.48%) |
| not tied: no tag now, no tag event (repository reachable now) | 568 / 1148 (49.48%) |
| not tied: no tag now, no tag event (repository not reachable now) | 90 / 1148 (7.84%) |
| unknown | 0 / 1148 (0.00%) |

- **Stopped by condition 1 (not tied): 1104 / 1148 (96.17%).** Tied: 44 / 1148 (3.83%).
- Without the two disputed versions (both "P names no repository"): not tied 1102 / 1146, tied 44 / 1146 (3.84%).
- **Condition 1 strengthened** (the tag's commit reachable from today's default branch): 39 / 1148 (3.40%) tied. 5 of the 44 tags are not reachable.
- **V's provenance:** none read. 1,140 versions are no longer listed; the other 8 have no attestations.

**P's repository** (§2): GitHub 702 (all from the registry), no repository 364 (281 from the registry, 83 from ecosyste.ms), not obtained 41, not GitHub 24, not understood 17. The 702 rows name 391 distinct repositories (case-insensitive). The reference lists answered 200 for 612 rows and 401 for 90; the API answered 200 for the same 612 and 404 for the same 90.

### The tag at the time (GH Archive, §4)

- **Looked up:** the 658 GitHub rows with no tag now. **All 658: no tag event**, with all 49 hours of every window read (not fully checked: 0).
- **The 44 rows with a tag now** (shown): all 49 hours of each window were read, and none has a `CreateEvent` for V's tag in its window.
- **Over all 702 GitHub rows, no `CreateEvent` for a tag of V's number was seen within 24 hours of V's publish.**
- No `DeleteEvent` of such a tag. 129 of the 658 rows have at least one `PushEvent` in their repository in the window, and 7 have another tag created there (hyperterm-hipster 1.0.3, synckit 0.11.9, napi-postinstall 0.3.1, wrap-ansi 9.0.1, has-ansi 6.0.1, @duckdb/duckdb-wasm 1.29.2, @ctrl/transmission 7.3.1). Those tag names are not V's forms; they are not recorded.
- Limits (definitions §4): GitHub makes no `CreateEvent` when more than three tags are pushed at once, and events of a private repository are not public.

### The 44 tags found now

Forms: form 1 (`vX`) 29, form 2 (`X`) 5, form 3 (`N@X`) 10. Reachable from the default branch 39, not reachable 5.

**The tag's commit time minus V's publish time** (committer time from the API; buckets as LO2, quartiles from the unrounded hours):

| ≤ −168 h | (−168, −24] | (−24, −1] | (−1, 0] | (0, 1] | (1, 24] | (24, 168] | > 168 h |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | 0 | 0 | 0 | 1 | 1 | 0 | 22 |

Median +102.51 h, minimum −69,730.52 h, maximum +6,130.27 h (`lt.json`, `malicious.tag_now.commit_minus_publish_hours`).

So 42 of the 44 tags have a commit more than a week away from V:
- **20 more than a week before V** (form 1: 14, form 2: 5, form 3: 1):
  - **19 of forms 1 and 2** (`vX`, `X`), which do not name the package. Most are in a repository that P's `package.json` names but that is not the package's own: for example devextreme-rpk and @ui-ux-gang/devextreme-rpk (DevExpress/DevExtreme), typeorm-orbit (typeorm/typeorm), @voiceflow/anthropic (anthropics/anthropic-sdk-typescript), uniswap-test-sdk-core (Uniswap/sdk-core). Any repository whose tag has that number ties them.
  - **1 of form 3**, which names the package: zapier-platform-legacy-scripting-runner 4.0.2, tag `zapier-platform-legacy-scripting-runner@4.0.2` in zapier/zapier-platform. Its commit is dated −252.66 h from V and is not reachable from the default branch (`diverged`). Dropping forms 1 and 2 would not remove it.
- **22 more than a week after V** (form 1: 13, form 3: 9): 9 rows in the asyncapi organisation (8 @asyncapi-scoped packages and asyncapi-preview), @postman/tunnel-agent 0.6.5–0.6.7, zapier-platform-cli/core/schema 18.0.2–18.0.4, @accordproject/template-engine 2.7.2. The tagged commits are dated +197.99 h to +6,130.27 h after V. Who pushed these tags, and when, is not in the data.
- **2 within a day after V:** @posthog/siphash 1.1.2 (+7.03 h, `PostHog/siphash-js` v1.1.2) and @hyperlook/telemetry-sdk 1.0.19 (+0.74 h, `DrDroidLab/telemetry-sdk` v1.0.19). Neither has a `CreateEvent` for the tag in its window.

Commit times are written by whoever makes the commit, and the time a tag was pushed is not public. So these hours show when the tagged commit says it was made, not when the tag appeared.

### Source diffs of the 44 (§6)

| Outcome | Rows |
| --- | --- |
| none (no new capability between P's release and V's tag) | 20 |
| new capability in the source | 4 (@asyncapi/avro-schema-parser 3.0.26: `api:fetch`; zapier-platform-cli 18.0.2, 18.0.3, 18.0.4: `new-dependency`) |
| not comparable: previous commit (package directory not found 11, directory not in source 4) | 15 |
| not comparable: no release for the previous version | 3 |
| not comparable: version commit (package directory not found) | 2 |

The tarball side was computed for none of them: all 44 malicious versions are no longer listed in the registry. **So condition 2 could not be measured on any malicious version here.** The 20 "none" rows are diffs between maintainers' tags, made after V (or, in the earlier-release cases, unrelated to V), not the malicious tarball's code.

### Not measured

**V's own `repository`.** V's version document came from the registry for only 8 rows (1 GitHub, 7 no repository). 447 are not obtained (ecosyste.ms 404 for 446, an empty copy for 1), and for 693 ecosyste.ms's copy has no `repository` (see below). So whether an attacker pointed V at another repository could not be measured: `version_names_other_repository` is empty for want of data, not because none did.

## Results: genuine fixes (192)

| | Rows |
| --- | --- |
| tied (LO2) | 172 / 192 (89.58%): tag 168, provenance 4 |
| tag commit reachable from the default branch | 85 of 168 (not reachable 82, all `diverged`; unknown 1: compare HTTP 404, @openzeppelin/contracts-upgradeable 5.4.0) |
| provenance commit reachable | 3 of 4 (not reachable 1) |
| **condition 1 strengthened** | **88 / 192 (45.83%)**; 88 / 172 (51.16%) of the tied |
| both prongs, plain condition 1 (LO2's figure, reproduced) | 163 / 192 (84.90%) |
| **both prongs, strengthened condition 1** | **83 / 192 (43.23%)** |

83 rows (82 tags and 1 provenance commit; 73 distinct commits in `gh-compare.tsv`) are not reachable from today's default branch, all `diverged`: next (19 rows; default `canary`), vite (13; `main`), react-server-dom-* (8), @sentry/* 8.49.0 (8; `develop`), @plone/volto (3), parse-server (3; `alpha`), and 29 rows of 26 other packages. The full list is in `lt.json` (`genuine.not_reachable`). `diverged` shows only that the commit is not an ancestor of today's default branch. Whether each is a backport on a release branch, or a release flow that merges elsewhere, was not checked.

## Where the run departed from the definitions

Found in review (PR comment 6528949262). The run is not repeated for them.
- **No match by `full_name` (§4).** `lt.ts` adds the current `full_name` to the names to match only when the API gave no id. But the API gives `full_name` only with an id, so matching by `full_name` never happened. Every repository with a `full_name` was matched by its id, which does not change on a rename, so the events found are the same.
- **Commit dates read on the host (§9).** `gh.sh` reads `repos/<owner>/<repo>/commits/<sha>` for the 38 distinct malicious tag commits, which §9 does not list. Only the committer date is kept (`--jq`), but the whole answer, patches included, reached the host `gh` process. Nothing else from it was written or opened.
- **`curl -I` on the host to GH Archive (§9).** Four `HEAD` requests for file sizes, before the archive phase, to estimate the volume. No file content was fetched on the host.

## What the definitions got wrong

**ecosyste.ms's copy never has `repository`.** After the run, the 1,178 cached ecosyste.ms answers were read: 710 hold a version document, and **none of the 710 has a `repository` key** (their keys include `dist`, `scripts`, `gitHead`, `_npmUser`, `deprecated`). So §2's fallback could only ever give "no repository". The 83 rows counted as "P names no repository (from ecosyste.ms)" are really "P not obtained": P is not listed in the registry (124 rows answered 404; 41 + 83 = 124). Read so, P names no repository 281 / 1148 and P not obtained 124 / 1148. Both are "not tied", so the stopped and tied counts do not change. The same applies to V's own repository above. The definitions are not changed; this is recorded here.

## Kinds of malicious version that condition 1 does not stop

From this data, as defined:
1. **A `vX` or `X` tag dated long before V** (19 rows): P's `package.json` names a repository with a tag of forms 1 or 2 whose commit is dated more than a week before V. Forms 1 and 2 match it whatever the package is.
2. **A tag naming the package, dated long before V** (1 row): zapier-platform-legacy-scripting-runner 4.0.2. Its form-3 tag's commit is dated −252.66 h and is not on the default branch, so the strengthened condition 1 does not tie it, but the plain one does.
3. **A tag whose commit is dated long after V** (22 rows, +197.99 h to +6,130.27 h). GH Archive shows no tag event within 24 hours of V for any of them. Who pushed these tags, and when, is not public. If the commit dates are true, the tags did not exist when V was published, and a check made then would not have tied V. A check made after the tag appeared ties V.
4. **A tagged commit dated within a day after V** (2 rows): @posthog/siphash 1.1.2 and @hyperlook/telemetry-sdk 1.0.19. GH Archive shows no tag event in the window, so when the tag was pushed is unknown.
5. **Not seen here:** an attacker who could also push a tag to the repository. No `CreateEvent` for V's tag was found within 24 hours for any of the 702 GitHub rows. The `CreateEvent` limit (more than three tags at once) and private repositories leave this short of proof.
6. **Not measurable here:** V naming another repository than P (V's repository could not be read), and condition 2 on a malicious tarball (none is listed).
