#!/usr/bin/env bash
# Inside the container, with the network and no Docker socket: sync, then install without install scripts.
set -euo pipefail
bash /src/docs/bench/lexp/scripts/sync.sh
cd /w/repo
npm ci --ignore-scripts --no-audit --no-fund
