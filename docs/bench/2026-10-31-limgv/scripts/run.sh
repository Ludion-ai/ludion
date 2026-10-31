#!/bin/sh
# run.sh <script> [args]: the script in Docker, no network, 4 GB, worktree read-only at /src, volume ludion-lphpv2-w at /w.
s=$1; shift
MSYS_NO_PATHCONV=1 docker run --rm --memory 4g --network none --tmpfs /tmp:exec -e LINES_MAX -v C:/dev/ludion-lphpv2:/src:ro -v "$(cd "$(dirname "$0")" && pwd -W)":/scripts:ro -v ludion-lphpv2-w:/w ludion-l9-node24-git sh /scripts/$s.sh "$@"
