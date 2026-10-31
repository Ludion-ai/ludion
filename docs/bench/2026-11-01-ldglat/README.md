# LDGLAT — Debian security fix → base image → official tag, measured in the past

Experiment, read-only. Definitions: docs/decisions/2026-11-01-ldglat-definitions.md, committed (8c8800d2f1bf1585ccea81e32f43124f971a5ac0) before anything was counted. Results: [results.md](results.md) (printed by `scripts/analyze.mjs`, copied unchanged) and [results.json](results.json). The summary and its reading are in [summary.md](summary.md).

## What was run, and where

Everything ran in containers of the local image `ludion-l9-node24-git` (node 24.22.1 on Debian 12, git 2.39.5, dpkg 1.21.23), as uid 1000, `--memory 2g`, with no credentials and no host environment, the Docker volume `ludion-ldglat-w`, this folder's `scripts/` mounted read-only and `raw/` (or this folder) as the only output. No image was pulled or run. Nothing on the host ran node, npm or python.

1. **Clone** (2026-10-31T15:19Z–15:21Z): `git clone --filter=blob:none --no-checkout https://github.com/docker-library/repo-info.git` into the volume; HEAD `2427e432ef7036b8bcc918aa1703b960a3d6dea7` (committed 2026-10-31T14:59:06Z, the data end). Nothing of it was checked out or copied to the host.
2. **Extract** (`scripts/extract.mjs`, raw/extract-started.txt … extract-finished.txt): for the 13 files of the definition's section 2, every commit from 2025-09-01 on and the one before, each listing's Image ID, `Created` and every dpkg source package with its version and first binary package. Output: `raw/commits.tsv` (538 commits), `raw/packages.tsv` (61,777 rows). Only these fields left the container.
3. **Snapshot** (`scripts/snapshot.mjs`, raw/snapshot-started.txt, docs/bench/2026-11-01-ldglat/raw/snapshot.log): for each of the 198 source packages in `raw/packages.tsv`, `/mr/package/<source>/`, then for each candidate version (those containing `deb12u`, and every version the files list) `/mr/package/<source>/<version>/allfiles?fileinfo=1`. Only Debian package names and versions were sent. The full answers stayed in the volume (cache); `raw/snapshot-files.jsonl` keeps, per candidate, the files that were used (the queried binary's amd64 and `all` files and the `.dsc`) with their whole `fileinfo`. Output: `raw/versions.tsv`, `raw/fixes.tsv`.
4. **Analyze** (`scripts/analyze.mjs`): from the three TSV files, writes `units.tsv`, `tag-units.tsv`, `secondary-units.tsv`, `intervals.tsv`, `results.json` and `results.md`.

To run again (Git Bash, `MSYS_NO_PATHCONV=1`), with `B` this folder:

```sh
docker volume create ludion-ldglat-w
docker run --rm --memory 2g --user 1000:1000 -e HOME=/w -v ludion-ldglat-w:/w ludion-l9-node24-git \
  git clone --filter=blob:none --no-checkout https://github.com/docker-library/repo-info.git /w/data/repo-info   # then check out nothing; pin to 2427e432 for the same data
docker run --rm --memory 2g --user 1000:1000 -e HOME=/w -v ludion-ldglat-w:/w -v "$B/scripts:/s:ro" -v "$B/raw:/o" ludion-l9-node24-git node /s/extract.mjs /w/data/repo-info /o
docker run --rm --memory 2g --user 1000:1000 -e HOME=/w -v ludion-ldglat-w:/w -v "$B/scripts:/s:ro" -v "$B/raw:/o" ludion-l9-node24-git node /s/snapshot.mjs /o/packages.tsv /w/snapcache /o
docker run --rm --memory 2g --network none --user 1000:1000 -v "$B/scripts:/s:ro" -v "$B/raw:/r:ro" -v "$B:/o" ludion-l9-node24-git node /s/analyze.mjs /r /o
```

(The volume needs `chown 1000:1000` once. `extract.mjs` reads the repository's HEAD history; for the same data, `git -C /w/data/repo-info reset --soft 2427e432…` first.)

Changed after their first run (summary.md, "Changes after the first run"; recorded in docs/decisions/2026-11-01-ldglat-after-first-run.md): `snapshot.mjs` reads `srcfiles` when `allfiles` is 404 (first output kept as docs/bench/2026-11-01-ldglat/raw/fixes-run1.tsv, log docs/bench/2026-11-01-ldglat/raw/snapshot.log); `analyze.mjs` leaves out versions ending in another release's suffix (`~deb11u1`) and prints stage 1's `Created` lower bound and the fixes the base already had.

The snapshot cache (the full JSON answers) stayed in the Docker volume and is not kept: the volume was removed at the end. raw/snapshot-files.jsonl keeps the parts used.

## What the times mean

- **Start** is snapshot.debian.org's `first_seen` in `debian-security`: the first snapshot run that had the file. The file may have been published up to one snapshot run earlier (a few hours; several runs a day).
- **Ends** are repo-info commit times: when its scan saw the changed listing. The image may have been pushed up to one scan interval earlier. The scan interval is not in the data (a commit is made only on a change), so it is 不明; the commit hours in results.md show that each image's commits come at a few fixed hours of the day. For the debian files, summary.md (stage 2) shows a case that, under its reading 2 (node got tzdata 2026e from the base image, not from its own apt), means the commit came at least 54 h after the image was in use by node, so a commit time can be days late. This is a reading, not a measurement.
- For debian images, `Created` is the archive snapshot time the image was built from (usually 00:00Z of a day; one of the six ending base listings has 2026-10-20T21:32:55Z), a lower bound of the push.
- amd64 only. Every security-archive upload counts the same.

## Not built here (design only)

Alpine as a range and the forward hourly record: the definition's section 8. No workflow file was written.
