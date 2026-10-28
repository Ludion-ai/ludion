# 2026-10-29 (LS) — The shadow's recorder started on the owner's PC

The recorder from #182 (8a78b55) runs on the owner's PC until the owner chooses a production place (docs/bench/2026-10-28-shadow-design, section 6). This is not that choice.
- **Container.** `ludion-shadow-recorder`, node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205, with:
  - a read-only root, user 1000, `--cap-drop ALL`, 2 GB memory and 1 CPU;
  - no host environment and no secret;
  - restart `unless-stopped`.
- **Code.** A `git archive` of 8a78b55, plus `semver` 7.8.5 from the lockfile, under `C:\dev\ludion-shadow-data\app\8a78b55…`.
- **Data.** `C:\dev\ludion-shadow-data\data`, with a limit of 1,900,000,000 bytes, so that the folder stays under 2 GB.
- **Start record.** 2026-10-28T15:51:48.101Z, commit 8a78b55940def8463a2401e7bdd38d7e6c7b604d. It names watched list sha256 `02d3e6de2cc5e4d05af15d60bb6f9ca7ac17ebd261b652c77a9ce23281674f6a` (7,660 names).
- **Feed start.** 2026-10-28T15:51:48.398Z, at seq 140366597. The first OSV read only set the position, at 2026-10-28T11:30:03.775067076Z.
- **At 16:04:05Z, about 12 minutes in.**
  - The status line says 3,490,333 bytes, and the folder is 4,247,098 bytes with the code.
  - It held 60 capture records: 4 baselines; 4 new versions, 4 lockfile versions and 39 predecessor versions; 8 `created` records; 1 deprecation.
  - One new version, @clerk/backend 3.26.5-canary.v20261028155804, has its attestations (HTTP 200) and a tarball file list of 343 files.
  - No string in the captures looks like an e-mail address.
- **Condition (b).** Under docs/decisions/2026-10-29-shadow-counting.md, the four weeks start at this first successful poll. A UTC day with no successful poll restarts them, so the PC must stay on and connected. The replay is not built, so there is no (b) result.
