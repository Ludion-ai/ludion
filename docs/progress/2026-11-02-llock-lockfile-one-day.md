# LLOCK: which lockfile public npm projects keep at their root, one day (2026-11-02)

Measurement only; no product behavior changes. Definition: docs/decisions/2026-11-02-lockfile-one-day-definition.md, committed and pushed at 64e56be1c65538d0762a839ba43c9354de66dab2 before the first request about a repository's files. How it ran, and the raw tables: docs/bench/lockfile-one-day/README.md.

Why it was asked for: docs/status.md at main 5b6e727de94ee5bd9fedfe12122f22d2ff4dcf94, line 59 (C10), line 72 (the scope table's heading), lines 76 and 77 (npm's lockfiles).

## The answer

**Among public repositories with a root package.json and a default-branch push in GH Archive's files of 2026-10-25, package-lock.json is the most common: 64.0% (95% interval 60.2–67.6, n = 1,000, weighted, effective n 633; files as answered on 2026-11-02), and 320/500 in each stratum.** Next, among the same repositories, is pnpm-lock.yaml: 15.5% (95% interval 12.9–18.5, n = 1,000, weighted, effective n 633). Its interval does not reach package-lock.json's.

What was decided from it: docs/decisions/2026-11-02-lockfile-scope-v1.md.

## Not the day the brief named

The brief named 2026-11-01. All 24 of that day's GH Archive files hold 0 PushEvents (docs/bench/lockfile-one-day/archive-scan.jsonl). By the rule fixed in the definition's section 1, the day is **2026-10-25**, the latest with PushEvents in all 24 files. Why the events are missing is not known. The owner accepted the change of day, with the result of about ±3.7 points, on 2026-11-02 at 19:53 JST (docs/decisions/2026-11-02-lockfile-scope-v1.md).

## The numbers

Pushes of 2026-10-25 UTC. Files as raw.githubusercontent.com answered from 2026-11-02T09:29:13Z to 09:52:43Z, at each repository's default branch. "New" is repository id 1087451773 or above (made since about 2025-11-01), "old" is below it. Per stratum: k/n, share, 95% Wilson interval. Overall: weighted (new 0.8809, old 0.1191), with a Wilson interval on the effective n of 633.

Copied from docs/bench/lockfile-one-day/counts.md.

**Each file on its own (a repository with two counts under both):**

| File | New | Old | Overall | Unknown |
|---|---|---|---|---|
| package-lock.json | 320/500 = 64.0% (59.7%–68.1%) | 320/500 = 64.0% (59.7%–68.1%) | 64.0% (60.2%–67.6%) | 0 |
| pnpm-lock.yaml | 78/500 = 15.6% (12.7%–19.0%) | 73/500 = 14.6% (11.8%–18.0%) | 15.5% (12.9%–18.5%) | 0 |
| yarn.lock (either format) | 2/500 = 0.4% (0.1%–1.4%) | 48/500 = 9.6% (7.3%–12.5%) | 1.5% (0.8%–2.8%) | 0 |
| yarn.lock, v1 | 1/500 = 0.2% (0.0%–1.1%) | 31/500 = 6.2% (4.4%–8.7%) | 0.9% (0.4%–2.0%) | 0 |
| yarn.lock, berry | 1/500 = 0.2% (0.0%–1.1%) | 17/500 = 3.4% (2.1%–5.4%) | 0.6% (0.2%–1.5%) | 0 |
| yarn.lock, neither format's line | 0/500 = 0.0% (0.0%–0.8%) | 0/500 = 0.0% (0.0%–0.8%) | 0.0% (0.0%–0.6%) | 0 |
| bun.lock or bun.lockb | 26/500 = 5.2% (3.6%–7.5%) | 33/500 = 6.6% (4.7%–9.1%) | 5.4% (3.9%–7.4%) | 0 |
| bun.lock | 26/500 = 5.2% (3.6%–7.5%) | 25/500 = 5.0% (3.4%–7.3%) | 5.2% (3.7%–7.2%) | 0 |
| bun.lockb | 0/500 = 0.0% (0.0%–0.8%) | 8/500 = 1.6% (0.8%–3.1%) | 0.2% (0.0%–0.9%) | 0 |

**Alone (these add up to 100%):**

| Group | New | Old | Overall | Unknown |
|---|---|---|---|---|
| only package-lock.json | 306/500 = 61.2% (56.9%–65.4%) | 297/500 = 59.4% (55.0%–63.6%) | 61.0% (57.1%–64.7%) | 0 |
| only pnpm-lock.yaml | 70/500 = 14.0% (11.2%–17.3%) | 67/500 = 13.4% (10.7%–16.7%) | 13.9% (11.4%–16.8%) | 0 |
| only yarn.lock | 2/500 = 0.4% (0.1%–1.4%) | 37/500 = 7.4% (5.4%–10.0%) | 1.2% (0.6%–2.4%) | 0 |
| only bun.lock | 20/500 = 4.0% (2.6%–6.1%) | 21/500 = 4.2% (2.8%–6.3%) | 4.0% (2.7%–5.9%) | 0 |
| only bun.lockb | 0/500 = 0.0% (0.0%–0.8%) | 2/500 = 0.4% (0.1%–1.4%) | 0.0% (0.0%–0.7%) | 0 |
| two or more of the five | 14/500 = 2.8% (1.7%–4.6%) | 25/500 = 5.0% (3.4%–7.3%) | 3.1% (2.0%–4.7%) | 0 |
| none of the five | 88/500 = 17.6% (14.5%–21.2%) | 51/500 = 10.2% (7.8%–13.2%) | 16.7% (14.0%–19.8%) | 0 |

**The population and the walk** (docs/bench/lockfile-one-day/population-summary.json):

| | Count |
|---|---|
| PushEvents in the 24 files | 1,360,916 |
| Left out: not public / not a branch / a name that cannot be asked about | 6 / 0 / 0 |
| Distinct repositories pushed to | 477,437 |
| In the population: the default branch known from that day's events | 33,108 |
| In the population: not known, pushed to main or master | 332,266 |
| Left out: known, and no push to it | 14,506 |
| Left out: not known, and no push to main or master | 97,557 |
| Population: new / old | 321,251 / 44,123 |
| Walked to find the sample: new / old | 2,184 / 2,224 |
| With a package.json: new / old | 500 / 501 (the sample takes the first 500; the walk asks four at a time) |
| Unknown answers, all requests | 0 |

## Limits

- **Overall is about ±3.7 points at package-lock.json's share (60.2–67.6), not the brief's ±3.** 88% of the weight is the new stratum and the allocation is 500 and 500, so the effective n is 633.
- **23.5% of the repositories pushed to are left out** (112,063 of 477,437), by the rule on the default branch: most (97,557) because the day names no default branch for them and they had no push to main or master. Those whose default branch has another name are not measured, and how many they are is not known.
- **GH Archive's day may be partial.** The hourly PushEvent count is lower than earlier in the year (2026-06-01 hour 12: 135,957; 2026-10-25 hour 12: 66,648). Whether what is missing is random is not known. 2026-10-25 lies in a stretch with gaps: the same scan has 0 PushEvents in 2026-09-01 hour 12, 2026-10-22 hour 18, all four hours looked at on 2026-10-23, and 2026-10-24 hour 0.
- **Who is counted.** Public repositories with a push that day, forks and bots included, with no filter for use or size. 88% by weight were made in about the last 12 months. It does not measure the projects of the people Ludion is to protect, or private repositories.
- **A one-day count, and the root only.** A workspace's lockfile below the root is not counted. A repository deleted or made private since that day counts as having no package.json. `npm-shrinkwrap.json` was not among the things to count.
- **Requests:** 9,408 HEADs and 50 GETs, more than the brief's "about 5,000", which leaves out the 4,408 HEADs that find the sample.
