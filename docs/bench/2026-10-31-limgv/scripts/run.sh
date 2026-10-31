#!/bin/sh
# run.sh <script> [args]: the script in Docker, no network, 4 GB, worktree read-only at /src, volume ludion-limgv-w at /w.
s=$1; shift
MSYS_NO_PATHCONV=1 docker run --rm --memory 4g --network none --tmpfs /tmp:exec -e LINES_MAX -v C:/dev/ludion-limgv:/src:ro -v "$(cd "$(dirname "$0")" && pwd -W)":/scripts:ro -v ludion-limgv-w:/w ludion-l9-node24-git sh /scripts/$s.sh "$@"
