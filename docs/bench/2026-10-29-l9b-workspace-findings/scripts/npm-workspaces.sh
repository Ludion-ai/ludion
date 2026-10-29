#!/bin/sh
# How the npm bundled in node:24-slim reads a "!" entry of "workspaces" (read only; nothing is run but cat and grep).
set -u
d=/usr/local/lib/node_modules/npm
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), npm $(npm -v), @npmcli/map-workspaces $(node -p "require('$d/node_modules/@npmcli/map-workspaces/package.json').version")"
echo "== lib/index.js lines 1-55"; sed -n 1,55p $d/node_modules/@npmcli/map-workspaces/lib/index.js
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
