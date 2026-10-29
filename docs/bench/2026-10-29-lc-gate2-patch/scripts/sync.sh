#!/bin/sh
# Copy the worktree (read-only mount /src) into the volume /w, keeping /w/node_modules.
set -e
cd /src
tar --exclude=./node_modules --exclude='./*/*/node_modules' --exclude='./*/node_modules' --exclude=./.git -cf - . | (cd /w && tar -xf -)
