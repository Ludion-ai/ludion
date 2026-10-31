#!/bin/sh
# From the worktree root on the host: sh docs/bench/2026-10-31-lmr1-impact-classes/scripts/run.sh setup|test|fetch|count [args]
# The worktree is mounted read-only at /src and copied into the volume ludion-lmr1-w; nothing runs on the host.
# setup (npm ci) and fetch (the two OSV zips) need the network; test and count run with --network none.
# No host environment, credential or other host path reaches the container. fetch and count, which read OSV's
# third-party data, also drop every capability.
set -u
here=docs/bench/2026-10-31-lmr1-impact-classes/scripts
script=$1; shift
case $script in setup | fetch | cwe) net=bridge ;; *) net=none ;; esac
case $script in fetch | count | cwe | pick | explore) caps="--cap-drop ALL --security-opt no-new-privileges" ;; *) caps= ;; esac
image=${IMAGE:-ludion-l9-node24-git}
# shellcheck disable=SC2086
MSYS_NO_PATHCONV=1 docker run --rm --network "$net" --memory=4g --cpus=2 $caps -v "$(pwd):/src:ro" -v ludion-lmr1-w:/w -v "$(pwd)/$here:/scripts:ro" "$image" sh "/scripts/$script.sh" "$@"
