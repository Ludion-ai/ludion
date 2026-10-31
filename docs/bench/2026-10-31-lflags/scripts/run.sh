#!/bin/sh
# From the host: runs scripts/<name>.sh in Docker with the worktree read-only at /src (as docs/bench/2026-10-30-lb-design's
# run.sh, with this lane's volumes). Usage: run.sh test [vitest args] | run.sh mutate
set -u
name=$1; shift
LB_HEAD=$(git -C "$(dirname "$0")" rev-parse HEAD); LB_DIRTY=$(git -C "$(dirname "$0")" status --porcelain | wc -l | tr -d ' '); export LB_HEAD LB_DIRTY
here=$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)
src=$(cd "$here/../../../.." && pwd -W 2>/dev/null || pwd)
case $name in
  test) MSYS_NO_PATHCONV=1 docker run --rm --memory 4g -e LB_HEAD -e LB_DIRTY -e CI= -v ludion-lflags-w:/w -v "$src:/src:ro" -v "$here:/scripts:ro" ludion-l9-node24-git sh /scripts/test.sh "$@" ;;
  # The mutations run with no network, on the volume test.sh installed (npm ci needs the registry).
  mutate) MSYS_NO_PATHCONV=1 docker run --rm --memory 4g --network none -e LB_HEAD -e LB_DIRTY -e MUTATE_ONLY -e MUTATE_RESULTS=/r/mutate-results.tsv -v ludion-lflags-w:/w -v "$src:/src:ro" -v "$here:/scripts:ro" -v "$here/../logs:/r" ludion-l9-node24-git sh /scripts/mutate.sh ;;
esac
