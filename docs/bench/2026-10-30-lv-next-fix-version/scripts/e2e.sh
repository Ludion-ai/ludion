#!/bin/sh
# The built CLI's patch --apply, twice, on a copy of examples/npm-security committed in its own throwaway repository.
# Live registry and OSV data: lodash 4.17.20's smallest fixed version, 4.18.0, is deprecated ("Bad release").
# Image ludion-la-runner (docs/bench/2026-10-29-la-per-fix-apply/scripts/runner.Dockerfile); Docker through the socket.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), $(docker --version)"
npm ci --ignore-scripts --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
npm run build -w ludion-ai >/tmp/build.log 2>&1; echo "build exit $?"
CLI=/w/packages/cli/dist/cli.js
dir=/e/npm; rm -rf "$dir"; mkdir -p /e; cp -r /w/examples/npm-security "$dir"
git -C "$dir" init -q && git -C "$dir" add -A && git -C "$dir" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm example && echo "committed $(git -C "$dir" rev-parse HEAD)"
node "$CLI" patch --dir "$dir" --apply; echo "patch exit $?"
echo "-- branches:"; git -C "$dir" branch --list 'ludion/*' --format='%(refname:short) %(objectname) parent=%(parent)'
for b in $(git -C "$dir" branch --list 'ludion/*' --format='%(refname:short)'); do echo "-- $b changes:"; git -C "$dir" diff --stat HEAD "$b"; git -C "$dir" diff HEAD "$b" -- package.json; git -C "$dir" log -1 --format='%an <%ae>%n%B' "$b"; done
echo "-- working tree status (empty means unchanged):"; git -C "$dir" status --porcelain --untracked-files=no
for receipt in "$dir"/.ludion/security/*.json; do echo "-- receipt $(basename "$receipt"):"; node /scripts/summary.mjs "$receipt"; done
echo "-- second run (the branch exists):"
node "$CLI" patch --dir "$dir" --apply; echo "patch exit $?"
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
