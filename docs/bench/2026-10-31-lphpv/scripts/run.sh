#!/bin/sh
# From anywhere on the host: runs scripts/<name>.sh in Docker with the worktree read-only at /src (LPHPV, from LNODE's).
# Usage: run.sh seed | run.sh full | run.sh test [vitest args] | run.sh mutate
# Every run has no network and 4 GB. seed copies node_modules from LNODE's volume (package-lock.json is unchanged since
# #185, before LNODE's npm ci), so no npm ci with network is needed; the others then run in /w.
set -u
name=$1; shift
LN_HEAD=$(git -C "$(dirname "$0")" rev-parse HEAD); LN_DIRTY=$(git -C "$(dirname "$0")" status --porcelain | wc -l | tr -d ' '); export LN_HEAD LN_DIRTY
here=$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)
src=$(cd "$here/../../../.." && pwd -W 2>/dev/null || pwd)
common="--rm --memory 4g --network none -e LN_HEAD -e LN_DIRTY -v $src:/src:ro -v $here:/scripts:ro"
case $name in
  seed) MSYS_NO_PATHCONV=1 docker run $common -v ludion-lnode-w:/from:ro -v ludion-lphpv-w:/w ludion-l9-node24-git sh /scripts/seed.sh ;;
  full) MSYS_NO_PATHCONV=1 docker run $common --tmpfs /tmp:exec -v ludion-lphpv-w:/w ludion-l9-node24-git sh /scripts/full.sh ;;
  test) MSYS_NO_PATHCONV=1 docker run $common --tmpfs /tmp:exec -v ludion-lphpv-w:/w ludion-l9-node24-git sh /scripts/test.sh "$@" ;;
  mutate) MSYS_NO_PATHCONV=1 docker run $common --tmpfs /tmp:exec -v ludion-lphpv-w:/w ludion-l9-node24-git sh /scripts/mutate.sh ;;
esac
