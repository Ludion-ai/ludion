#!/bin/sh
# Sync, then typecheck and the given vitest files (all when none).
sh /s/sync.sh
cd /w
echo "== typecheck"; npx tsc -p tsconfig.json 2>&1 | tail -20; echo "tsc exit $?"
echo "== vitest"; npx vitest run "$@" 2>&1 | tail -60
