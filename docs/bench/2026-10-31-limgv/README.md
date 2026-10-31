# LIMGV — the official image's newest release: tests and mutations

Definitions: docs/decisions/2026-10-31-limgv-official-image-newest-release.md. Result: docs/progress/2026-10-31-limgv-official-image-newest-release.md.

- `scripts/run.sh <name>` runs `scripts/<name>.sh` in Docker (`ludion-l9-node24-git`, node v24.22.1) with `--network none` and `--memory 4g`. The worktree (`C:/dev/ludion-lphpv2`, written into run.sh) is mounted read-only at /src, and the volume `ludion-lphpv2-w` at /w. That volume's node_modules were copied from LPHPV's volume (`ludion-lphpv-w`), whose package-lock.json is byte for byte this one. No `npm ci` and no network was used.
- `full.sh` copies the worktree into /w (`sync.sh`), makes a stand-in Git repository there (the site's build asks Git for the top folder), and runs `npm run build`, `npm run typecheck` and `npm test -- --maxWorkers=2`.
- `mutate.sh`, after `full.sh`, applies each mutation in `mutate.mjs` alone (one exact text, replaced once) and runs the whole vitest run (`npx vitest run --maxWorkers=2`), restoring the file after each. A mutation is caught when vitest fails.
- `test.sh` runs typecheck and the node vitest project, used while writing.
- `logs/full.log` and `logs/mutate.log` were made at commit b74c3541fb37497b83c6e0dcfb58c96570500d8c, with no file in the worktree differing from it (`git status --porcelain` printed nothing).
- The official lists the decision record quotes (php.net's 8.1, 8.3, 8.4 and 8.5 lists and nodejs.org's index, on 2026-10-31) were read with `curlimages/curl:8.11.1` (read-only, `--cap-drop ALL`, no-new-privileges, no mounts). They were not saved here, and no test uses them.
