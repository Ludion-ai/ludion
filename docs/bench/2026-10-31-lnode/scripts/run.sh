#!/bin/sh
# From anywhere on the host: runs scripts/<name>.sh in Docker with the worktree read-only at /src (LNODE).
# Usage: run.sh ci | run.sh full | run.sh test [vitest args] | run.sh mutate | run.sh e2e [cases]
# ci (with network) copies the worktree into the volume and runs npm ci there; test and mutate then run with no network.
# e2e passes the host's Docker socket: that container can start containers that mount the host's files, so whatever runs
# in it has the host's power. e2e.sh therefore installs with --ignore-scripts (docs/mistakes/2026-11-01-docker-sock-npm-ci.md).
set -u
name=$1; shift
LN_HEAD=$(git -C "$(dirname "$0")" rev-parse HEAD); LN_DIRTY=$(git -C "$(dirname "$0")" status --porcelain | wc -l | tr -d ' '); export LN_HEAD LN_DIRTY
here=$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)
src=$(cd "$here/../../../.." && pwd -W 2>/dev/null || pwd)
common="--rm --memory 4g -e LN_HEAD -e LN_DIRTY -v $src:/src:ro -v $here:/scripts:ro"
case $name in
  ci) MSYS_NO_PATHCONV=1 docker run $common -v ludion-lnode-w:/w ludion-l9-node24-git sh /scripts/ci.sh ;;
  full) MSYS_NO_PATHCONV=1 docker run $common --network none --tmpfs /tmp:exec -v ludion-lnode-w:/w ludion-l9-node24-git sh /scripts/full.sh ;;
  test) MSYS_NO_PATHCONV=1 docker run $common --network none --tmpfs /tmp:exec -v ludion-lnode-w:/w ludion-l9-node24-git sh /scripts/test.sh "$@" ;;
  mutate) MSYS_NO_PATHCONV=1 docker run $common --network none --tmpfs /tmp:exec -v ludion-lnode-w:/w ludion-l9-node24-git sh /scripts/mutate.sh ;;
  e2e) MSYS_NO_PATHCONV=1 docker run $common -v ludion-lnode-w:/w -v ludion-lnode-e:/e -v /var/run/docker.sock:/var/run/docker.sock ludion-la-runner sh /scripts/e2e.sh "$@" ;;
esac
