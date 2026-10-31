#!/bin/sh
# Runs in Docker only, in npm 12.2.1's image, with the network for the registry's manifests: a project that lists
# left-pad in both dependencies and devDependencies, and the flags npm 12.2.1 writes on it (an assumption of
# computedFlags the corpus does not hold: a later group replaces an earlier one, and devDependencies come last).
set -u
d=/tmp/p; mkdir -p "$d" && cd "$d"
echo '{ "name": "x6", "version": "1.0.0", "dependencies": { "left-pad": "1.3.0" }, "devDependencies": { "left-pad": "1.3.0" } }' > package.json
npm install --package-lock-only --ignore-scripts --no-audit --no-fund --allow-git=none --allow-remote=none --allow-file=none --allow-directory=none --registry=https://registry.npmjs.org > npm.log 2>&1; echo "npm $(npm -v) exit $?"
cat package-lock.json
