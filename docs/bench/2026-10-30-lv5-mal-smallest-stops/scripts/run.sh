#!/bin/sh
# From the worktree root on the host: sh docs/bench/2026-10-30-lv5-mal-smallest-stops/scripts/run.sh test|full [vitest args]
# The worktree is mounted read-only at /src and copied into the volume ludion-lv5-w; nothing runs on the host.
set -u
here=docs/bench/2026-10-30-lv5-mal-smallest-stops/scripts
script=$1; shift
image=${IMAGE:-ludion-l9-node24-git}
MSYS_NO_PATHCONV=1 docker run --rm ${DOCKER_ARGS:-} -v "$(pwd):/src:ro" -v ludion-lv5-w:/w -v "$(pwd)/$here:/scripts:ro" "$image" sh "/scripts/$script.sh" "$@"
