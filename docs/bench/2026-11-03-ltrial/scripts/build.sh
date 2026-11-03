#!/bin/sh
# Runs only inside node:24 with --memory, no Docker socket and no token (docs/decisions/2026-11-03-ltrial-two-runs.md).
# /w is a Docker volume; /out is a folder outside the work tree. Writes the files to place in ludion-trial to /out.
set -e
SHA=3d143fe2a17bf06d9c03292b3bfe57e1b3178617
rm -rf /w/repo
git init -q /w/repo
cd /w/repo
git remote add origin https://github.com/Ludion-ai/ludion.git
git fetch -q --depth 1 origin "$SHA"
git checkout -q FETCH_HEAD
echo "HEAD $(git rev-parse HEAD)"
[ "$(git rev-parse HEAD)" = "$SHA" ]
echo "node $(node -v) npm $(npm -v)"
npm ci --ignore-scripts > /out/build-npm-ci.txt 2>&1; echo "npm-ci exit $?"
npm run build -w ludion-ai > /out/build-cli.txt 2>&1; echo "build exit $?"
node action/build.ts > /out/build-action.txt 2>&1; echo "action build exit $?"
sha256sum packages/cli/dist/cli.js action/dist/record.js
wc -c packages/cli/dist/cli.js action/dist/record.js
rm -rf /out/action-tree /out/sample /out/template
mkdir -p /out/action-tree/packages/cli/dist /out/action-tree/action/dist /out/sample /out/template
cp action.yml LICENSE /out/action-tree/
for file in action/*; do
  [ -f "$file" ] && [ "$file" != action/build.ts ] && cp "$file" /out/action-tree/action/
done
cp packages/cli/dist/cli.js /out/action-tree/packages/cli/dist/cli.js
cp action/dist/record.js /out/action-tree/action/dist/record.js
cat > /out/action-tree/BUILD.md <<EOF
Built from Ludion-ai/ludion $SHA for a private trial (LTRIAL). Not a release.
In Docker (node:24, $(node -v), npm $(npm -v)): npm ci --ignore-scripts; npm run build -w ludion-ai; node action/build.ts.
EOF
git archive HEAD examples/npm-security | tar -x -C /out/sample --strip-components=2
cp action/patch-workflow.yml /out/template/patch-workflow.yml
( cd /out/action-tree && find . -type f | sort ) > /out/action-tree-files.txt
( cd /out/sample && find . -type f | sort ) > /out/sample-files.txt
echo "memory.peak $(cat /sys/fs/cgroup/memory.peak)"
