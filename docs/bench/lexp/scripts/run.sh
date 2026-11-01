#!/usr/bin/env bash
# On the host: run one of the scripts above in node:24 pinned by digest, the worktree read-only, the volume for writes.
# NET=1 gives the network (install only). No Docker socket is passed.
set -euo pipefail
IMAGE=node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413
script=$1; shift
net=(--network none); [ "${NET:-0}" = 1 ] && net=()
MSYS_NO_PATHCONV=1 docker run --rm --memory 4g "${net[@]}" -e LOG="${LOG:-run.log}" -e TAILN="${TAILN:-60}" \
  -v ludion-lexp-w:/w -v "C:/dev/ludion-lexp:/src:ro" -w /w node:24@sha256:e7add2a490bb17d97b485b8641bd88455fff7839ade0f5eba493c3508124d413 \
  bash "/src/docs/bench/lexp/scripts/$script" "$@"
