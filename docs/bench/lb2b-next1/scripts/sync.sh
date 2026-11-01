#!/usr/bin/env bash
# Inside the container: copy the read-only worktree (/src) into the volume's /w/repo, keeping /w/repo/node_modules.
set -euo pipefail
mkdir -p /w/repo
cd /src
find /w/repo -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
tar --exclude=./.git --exclude=./node_modules --exclude='./*/node_modules' --exclude='./*/*/node_modules' -cf - . | tar -xf - -C /w/repo
cd /w/repo
if [ ! -d .git ]; then git init -q && git add -A >/dev/null 2>&1 && git -c user.email=t@t -c user.name=t commit -qm sync >/dev/null 2>&1 || true; fi
echo synced
