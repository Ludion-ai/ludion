#!/bin/sh
# With network, into the volume /w only: the locked dependencies, install scripts off. Nothing else runs with network.
set -eu
cd /w && npm ci --ignore-scripts --no-audit --no-fund
