#!/bin/sh
# Copy the worktree (read-only mount /src) into the volume /w, keeping the installed node_modules folders.
# Files outside node_modules are removed first, so a file deleted from the worktree is gone from /w too.
set -e
find /w -mindepth 1 -type f -not -path '*/node_modules/*' -delete
cd /src
tar --exclude=./node_modules --exclude='./*/*/node_modules' --exclude='./*/node_modules' --exclude=./.git -cf - . | (cd /w && tar -xf -)
