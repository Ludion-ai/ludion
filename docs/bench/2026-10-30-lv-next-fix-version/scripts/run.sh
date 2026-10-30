#!/bin/sh
# From the worktree root on the host: sh docs/bench/2026-10-30-lv-next-fix-version/scripts/run.sh test|full [vitest args]
# The worktree is mounted read-only at /src and copied into the volume ludion-lv-w; nothing runs on the host.
set -u
here=docs/bench/2026-10-30-lv-next-fix-version/scripts
script=$1; shift
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd):/src:ro" -v ludion-lv-w:/w -v "$(pwd)/$here:/scripts:ro" ludion-l9-node24-git sh "/scripts/$script.sh" "$@"
