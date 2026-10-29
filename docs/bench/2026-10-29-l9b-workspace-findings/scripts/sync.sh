#!/bin/sh
# Copy the worktree (read-only at /src) into the volume /w, keeping /w/node_modules.
set -eu
find /w -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
cd /src && tar --exclude=./.git --exclude=./node_modules --exclude='./*/node_modules' -cf - . | tar -C /w -xf -
