# 2026-10-29 (SA) — The shadow's recorder moves to a scheduled GitHub Actions workflow

The owner chose option A of docs/bench/2026-10-28-shadow-design, section 6 (owner, 2026-10-29 09:30 JST: シャドー運用の本番は GitHub Actions の定期実行にする). This file fixes how. The estimate behind it (storage, cost, permissions, with sources) is docs/bench/2026-10-29-shadow-actions/README.md. Nothing here changes how condition (b) is counted (docs/decisions/2026-10-29-shadow-counting.md), the wait table or any gate's numbers.

**1. What runs.**
- **The workflow.** `.github/workflows/shadow.yml`, on `schedule` only, at minute 17 of every hour. One run at a time (`concurrency: shadow`, not cancelled in progress).
- **The recorder.** `tools/shadow/src/recorder.ts` at 8a78b55940def8463a2401e7bdd38d7e6c7b604d, the commit the owner's PC runs, with the frozen watched list (sha256 `02d3e6de…f6a`, checked before each run). The workflow pins that commit, so a later change to tools/shadow on main does not change what the shadow records. Moving to a newer recorder is a change to the workflow, a protected path.
- **The driver.** `.github/shadow/record.ts` is the recorder's own loop (`run()`) with an end: it polls every minute and starts no poll after `RECORD_SECONDS` (3,000 s). The recorder's code is not changed.
- **The runtime.** The PC's image, node:24-slim by digest, with the PC's flags: read-only root, `--cap-drop ALL`, no new privileges, 2 GB, 1 CPU, no host environment. The only package added to the pinned code is semver, from the pinned commit's lockfile, checked against its sha512 integrity.

**2. Where the data lives.**
- **The branch `shadow-data`** of this repository, public: an orphan branch with no code. The captures are public registry data without e-mail addresses (the recorder's README).
- **Its layout.** `state.json` and `known/` at the root, as the recorder keeps them. Each run's lines go under `runs/<UTC day>/<HHMMSS>Z-<run id>-<attempt>/{captures,osv,status}/<UTC day>.jsonl`, and the PC's lines under `runs/pc-8a78b55/`, cut into `<day>.partNN.jsonl` where a file passes 50,000,000 bytes. So the replay reads every `*.jsonl` under every `runs/**/<kind>/`; the time in a run's directory name is when it was packed, and each record carries its own times.
- **Nothing is rewritten** but `state.json` and the `known/` files of names that changed. A run's lines are new files, so no file grows from commit to commit.
- **The storage limit.** 3,800,000,000 bytes, twice the PC's, counted over every file on the branch: the recorder counts `state.json` and `known/` on disk, and the record job adds the size of everything else on the branch, read from GitHub's tree listing. The PC's 1.9 GB would be reached at about the shadow's six weeks at the measured rate (estimate, "Storage"). Stopping at the limit is the recorder's own stop, which the counting file treats as a break if it lasts a UTC day.

**3. Permissions: the split of judge.yml and judge-comment.yml.**
- **Top level:** `permissions: {}`.
- **record:** `contents: read`. No secret. Checkouts keep no credential. It is the only job that runs Node, and it runs it only in the container.
- **write:** `actions: read` (its own run's artifact) and `contents: write` (the push). It runs no Node, npm or Docker. It refuses:
  - a run directory that is not this run's;
  - a data branch that moved after the record job read it;
  - a run directory already on the branch;
  - an artifact over 1 GiB;
  - anything in the artifact but regular files at the recorder's own paths (`state.json`, `known/…/<sha256>.json`, this run's `runs/…/<kind>/<day>.jsonl`);
  - a `state.json` that is not an object with a string `seq`.
- **The token cannot reach main.** main requires the `test` and `protected-paths` checks and a reviewed PR, for administrators too (read from GitHub on 2026-10-29). The job pushes only `HEAD:refs/heads/shadow-data`.
- **Pushes start nothing.** GitHub does not start workflows for events made with the workflow's own token, apart from `workflow_dispatch` and `repository_dispatch` (events doc, in the estimate).
- **No secret, no new account, no Cloudflare resource.**

**4. Failures are visible, and none starts a new shadow.**
- **No data branch:** the checkout fails. The workflow never creates the branch, so it cannot start a second shadow with a new feed start by accident. The owner seeds it once from the PC's data (section 5).
- **A run fails** when:
  - the recorder stopped at its limit (exit 3);
  - no poll succeeded in the run (exit 4);
  - the recorder exited otherwise or was still running 25 minutes after its deadline;
  - the image could not be pulled after three tries;
  - the writer refused the artifact.

  What was recorded before the failure is still committed when the artifact passes the writer's checks.
- **A failed or dropped run** loses no feed entry: the next run resumes from the committed `state.json`. Versions removed within the gap cannot be captured, and are capture gaps for the replay, as on the PC.
- **A UTC day with no successful poll** still ends the run of consecutive weeks (counting file, section 2). Hourly runs make that unlikely, but not impossible: an Actions outage, a broken pull, or a stop at the limit.

**5. Moving from the PC.** The counting file says that moving does not end the run if no UTC calendar day is lost. The order:
1. The owner merges the workflow PR. A run that fires before step 3 fails at the checkout, by design.
2. The owner stops `ludion-shadow-recorder` on the PC.
3. Within the same hour, the owner (or an agent the owner asks) runs `docs/bench/2026-10-29-shadow-actions/scripts/seed-data-branch.sh` with the PC's data directory. It pushes `shadow-data` once, refuses if the branch exists, and never force-pushes.
4. The next run at minute 17 resumes from the PC's feed position.

Steps 2 to 4 must fall on the same UTC day as the PC's last poll. The PC keeps recording until then; this PR does not stop it.

**6. What this changes from the PC, and what it does not.**
- **Capture lag.** The PC polls every minute, always. Here, polls run for 50 minutes of each hour, and a scheduled run can start late. So a version can wait about 10 minutes, or more under load, before its first capture. A version removed in that time is a capture gap. The lag is shown next to the gate (counting file, section 8), not gated.
- **Clock.** `fetched_at` comes from the runner's clock instead of the PC's.
- **Unchanged.** The recorder's code, the watched list, the hosts it may ask, what it stores, how it scrubs e-mail addresses, its retries, and the counting.
