#!/bin/sh
set -e
sh /s/sync.sh
cd /w
npm ci --ignore-scripts --no-audit --no-fund 2>&1 | tail -5
