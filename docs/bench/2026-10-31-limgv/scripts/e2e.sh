#!/bin/sh
# LIMGV's hand check: both jobs of the scheduled workflow, twice per case, as LNODE's e2e.sh (docs/bench/2026-10-31-lnode/
# scripts/e2e.sh, whose github.mjs and summary.mjs are used from /lnode), against the real nodejs.org, php.net, Docker Hub
# and Docker; GitHub's API is the stand-in github.mjs. Not run by this lane (the coordinator runs it; see ../README.md).
# Usage: e2e.sh <case>...
#   node         examples/node-security as it is (node:22.22.0-alpine): a move with security releases between, no wait.
#   php          examples/php-security as it is (php:8.4.26-cli-alpine).
#   node-newest  the same with FROM node:${NEWEST_FROM:-24.22.1-alpine}: a line's security release that is no longer its
#                newest (on 2026-10-31, 24.22.2 of 2026-10-27 is newer and not marked security). Expected: run 1 moves to
#                the line's newest release with an empty security_releases, its wait_until passed, a commit paragraph
#                "Node.js <new>, the newest release of the line (no newer security release); ..." and a PR with no
#                "security" in its title or body; run 2 opens no PR.
#   node-missing the same with FROM node:${MISSING_FROM}, a variant of an older release whose tag Docker Hub does not have
#                for the line's newest release (to be chosen first with `docker manifest inspect node:<newest>-<variant>`).
#                Expected: patch stops with "Docker Hub has no node:<tag>, ..." and nothing is packed or opened.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), $(docker --version)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
npm run build -w ludion-ai >/tmp/build.log 2>&1; echo "build exit $?"
CLI=/w/packages/cli/dist/cli.js
G() { git -c user.name=e2e -c user.email=e2e@example.invalid -c init.defaultBranch=main "$@"; }
port=8790
for case in "$@"; do
  d=/e/$case; rm -rf "$d"; mkdir -p "$d"
  echo "== case $case"
  case $case in
    node|php) cp -r "/w/examples/$case-security" "$d/work" ;;
    node-newest) cp -r /w/examples/node-security "$d/work"; sed -i "1s#.*#FROM node:${NEWEST_FROM:-24.22.1-alpine}#" "$d/work/Dockerfile" ;;
    node-missing) cp -r /w/examples/node-security "$d/work"; sed -i "1s#.*#FROM node:${MISSING_FROM:?set MISSING_FROM}#" "$d/work/Dockerfile" ;;
    *) echo "unknown case $case"; continue ;;
  esac
  head -1 "$d/work/Dockerfile" | sed 's/^/  /'
  G -C "$d/work" init -q && G -C "$d/work" add -A && G -C "$d/work" commit -qm example
  G init -q --bare "$d/origin.git" && G -C "$d/work" push -q "$d/origin.git" HEAD:refs/heads/main
  base=$(git -C "$d/work" rev-parse HEAD); echo "base $base"
  port=$((port + 1))
  node /lnode/github.mjs "$d/github.json" "$d/origin.git" "$port" & server=$!
  sleep 1
  for run in 1 2; do
    echo "-- run $run, validation job (contents: read): fresh clone, patch --apply, deliver pack"
    v=$d/v$run; G clone -q --depth 1 "file://$d/origin.git" "$v" && git -C "$v" checkout -q --detach
    node "$CLI" patch --dir "$v" --apply --json > "$d/result$run.json" 2>"$d/patch$run.err"; echo "patch exit $?"; sed 's/^/  stderr: /' "$d/patch$run.err" | head -5
    node /lnode/summary.mjs "$d/result$run.json"
    node -e 'try{const o=JSON.parse(require("fs").readFileSync(process.argv[1]));const s=o.scan??o.receipt?.scan;if(s)console.log(`  scan: ${s.status}, candidate ${s.candidate?.version}, wait_until ${s.wait_until}`)}catch{}' "$d/result$run.json"
    node "$CLI" deliver pack --dir "$v" --result "$d/result$run.json" --out "$d/artifact$run"; echo "pack exit $?"
    [ -f "$d/artifact$run/fixes.bundle" ] && git -C "$v" bundle list-heads "$d/artifact$run/fixes.bundle" | sed 's/^/  head /'
    echo "-- run $run, PR job (contents and pull-requests: write): fresh clone, deliver open"
    p=$d/p$run; G clone -q --depth 1 "file://$d/origin.git" "$p" && git -C "$p" checkout -q --detach
    GH_TOKEN=e2e-token node "$CLI" deliver open --dir "$p" --artifact "$d/artifact$run" --base "$base" --repo o/r --ref refs/heads/main --api "http://127.0.0.1:$port" --remote "$d/origin.git"; echo "open exit $?"
    for b in $(git --git-dir "$d/origin.git" for-each-ref --format='%(refname:short)' refs/heads/ludion/); do
      echo "  $b: $(git --git-dir "$d/origin.git" show "$b:Dockerfile" | grep '^FROM')"
      git --git-dir "$d/origin.git" log -1 --format=%B "$b" | sed 's/^/    | /'
    done
  done
  echo "-- PRs in the stand-in:"; node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));for(const p of s.pulls)console.log(`  #${p.number} ${p.state} ${p.head.ref}: ${p.title}; "security" in title or body: ${/security/i.test(p.title+p.body)}`)' "$d/github.json"
  kill $server
done
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
