#!/usr/bin/env bash
# Typecheck, the recorder's tests, and four deliberate mutations, each run in Docker with no network
# (node:24-slim pinned by digest, read-only root, user 1000). Each mutation must make a test fail; the file is
# restored after each. Run from the repository root with a Linux node_modules volume:
#   bash docs/bench/2026-10-29-shadow-recorder/scripts/check.sh ludion-ls-nm > docs/bench/2026-10-29-shadow-recorder/logs/check.log 2>&1
set -u
export MSYS_NO_PATHCONV=1
NM="$1"
W=$(pwd -W 2>/dev/null || pwd)
IMAGE=node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
F=tools/shadow/src/recorder.ts
run() { docker run --rm --network none --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -v "$W:/w:ro" -v "$NM:/w/node_modules" -w /w "$IMAGE" sh -c "$1"; }
echo "commit: $(git rev-parse HEAD)  recorder.ts blob: $(git hash-object $F)  test blob: $(git hash-object tools/shadow/test/recorder.test.ts)"
echo "== typecheck"; run "npx tsc -p tsconfig.json; echo tsc_exit=\$?"
echo "== tests"; run "npx vitest run tools/shadow 2>&1 | grep -E 'Tests |Test Files |✓|×'"
cp "$F" "$F.orig"
mutate() {
  echo "== mutation: $1"
  node -e "const fs=require('fs');const s=fs.readFileSync('$F','utf8');const t=s.replace(process.argv[1],process.argv[2]);if(t===s)process.exit(3);fs.writeFileSync('$F',t)" "$2" "$3" || { echo "mutation not applied"; return; }
  run "npx vitest run tools/shadow 2>&1 | grep -E 'Tests '"
  cp "$F.orig" "$F"
}
mutate "e-mail scrub off" 'return scrubText(value);' 'return value;'
mutate "storage limit off" 'if (this.bytes + Buffer.byteLength(line) > this.cfg.maxBytes)' 'if (false)'
mutate "integrity check off" '!== integrity) return { status: "integrity_mismatch"' '=== "never") return { status: "integrity_mismatch"'
mutate "first sight never new" 'started !== null && time[v] !== undefined' 'false && time[v] !== undefined'
rm "$F.orig"
git diff --quiet -- "$F" && echo "recorder.ts restored"
