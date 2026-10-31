#!/bin/sh
# From the worktree root on the host: runs scripts/<name>.sh in Docker with the worktree read-only at /src.
# Usage: run.sh test [vitest args] | run.sh mutate | run.sh e2e [cases]
# e2e passes the host's Docker socket: that container can start containers that mount the host's files, so whatever runs
# in it has the host's power. e2e.sh therefore installs with --ignore-scripts (docs/mistakes/2026-11-01-docker-sock-npm-ci.md).
set -u
name=$1; shift
# Each log names the commit it ran at, and how many files differed from it (git status --porcelain lines).
LB_HEAD=$(git -C "$(dirname "$0")" rev-parse HEAD); LB_DIRTY=$(git -C "$(dirname "$0")" status --porcelain | wc -l | tr -d ' '); export LB_HEAD LB_DIRTY
here=$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)
src=$(cd "$here/../../../.." && pwd -W 2>/dev/null || pwd)
case $name in
  test) MSYS_NO_PATHCONV=1 docker run --rm -e LB_HEAD -e LB_DIRTY -v ludion-lb-w:/w -v "$src:/src:ro" -v "$here:/scripts:ro" ludion-l9-node24-git sh /scripts/test.sh "$@" ;;
  mutate) MSYS_NO_PATHCONV=1 docker run --rm -e LB_HEAD -e LB_DIRTY -v ludion-lb-m:/w -v "$src:/src:ro" -v "$here:/scripts:ro" ludion-l9-node24-git sh /scripts/mutate.sh ;;
  e2e) MSYS_NO_PATHCONV=1 docker run --rm -e LB_HEAD -e LB_DIRTY -v ludion-lb-w:/w -v ludion-lb-e:/e -v /var/run/docker.sock:/var/run/docker.sock -v "$src:/src:ro" -v "$here:/scripts:ro" ludion-la-runner sh /scripts/e2e.sh "$@" ;;
esac
