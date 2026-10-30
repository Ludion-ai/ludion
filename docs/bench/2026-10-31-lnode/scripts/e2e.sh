#!/bin/sh
# Both jobs of the scheduled workflow on copies of examples/*-security, in Docker (image ludion-la-runner: node 24,
# git, the Docker CLI on the host's socket). GitHub's Git is a local bare repository and its API a stand-in
# (github.mjs). Clones are depth 1 with HEAD detached, as actions/checkout makes them. Each case runs the workflow twice: validation job (a fresh clone, patch --apply, deliver pack), then
# PR job (another fresh clone, deliver open). The second run must open no PR.
# Usage: e2e.sh <case>...  Cases: npm, npm-two, php, node, composer, maven (copied from docs/bench/2026-10-30-lb-design; node added by LNODE).
set -u
sh /scripts/sync.sh
echo "# at commit ${LN_HEAD:-unknown}, ${LN_DIRTY:-unknown} files differing from it"
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
    npm-two)
      # Two fixes: lodash (as examples/npm-security) and minimist 1.2.5. The lockfile is made again with npm, here in Docker.
      cp -r /w/examples/npm-security "$d/work"
      node -e 'const f=process.argv[1],p=JSON.parse(require("fs").readFileSync(f));p.dependencies.minimist="1.2.5";require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$d/work/package.json"
      (cd "$d/work" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/tmp/lock.log 2>&1; echo "lockfile exit $?")
      ;;
    *) cp -r "/w/examples/$case-security" "$d/work" ;;
  esac
  G -C "$d/work" init -q && G -C "$d/work" add -A && G -C "$d/work" commit -qm example
  G init -q --bare "$d/origin.git" && G -C "$d/work" push -q "$d/origin.git" HEAD:refs/heads/main
  base=$(git -C "$d/work" rev-parse HEAD); echo "base $base"
  port=$((port + 1))
  node /scripts/github.mjs "$d/github.json" "$d/origin.git" "$port" & server=$!
  sleep 1
  for run in 1 2; do
    echo "-- run $run, validation job (contents: read): fresh clone, patch --apply, deliver pack"
    v=$d/v$run; G clone -q --depth 1 "file://$d/origin.git" "$v" && git -C "$v" checkout -q --detach
    node "$CLI" patch --dir "$v" --apply --json > "$d/result$run.json"; echo "patch exit $?"
    node /scripts/summary.mjs "$d/result$run.json"
    node "$CLI" deliver pack --dir "$v" --result "$d/result$run.json" --out "$d/artifact$run"; echo "pack exit $?"
    ls -l "$d/artifact$run" | sed 1d | awk '{print "  " $5 " bytes " $9}'
    [ -f "$d/artifact$run/fixes.bundle" ] && git -C "$v" bundle list-heads "$d/artifact$run/fixes.bundle" | sed 's/^/  head /'
    echo "-- run $run, PR job (contents and pull-requests: write): fresh clone, deliver open"
    p=$d/p$run; G clone -q --depth 1 "file://$d/origin.git" "$p" && git -C "$p" checkout -q --detach
    GH_TOKEN=e2e-token node "$CLI" deliver open --dir "$p" --artifact "$d/artifact$run" --base "$base" --repo o/r --ref refs/heads/main --api "http://127.0.0.1:$port" --remote "$d/origin.git"; echo "open exit $?"
    echo "-- origin's branches:"; git --git-dir "$d/origin.git" for-each-ref --format='  %(refname:short) %(objectname)' refs/heads
    for b in $(git --git-dir "$d/origin.git" for-each-ref --format='%(refname:short)' refs/heads/ludion/); do
      echo "  $b: parent $(git --git-dir "$d/origin.git" rev-parse "$b^") changes $(git --git-dir "$d/origin.git" diff-tree -r --no-commit-id --name-only "$b" | tr '\n' ' ')"
      git --git-dir "$d/origin.git" show "$b:Dockerfile" 2>/dev/null | grep "^FROM" | sed "s/^/    Dockerfile: /"
    done
  done
  echo "-- PRs in the stand-in:"; node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));for(const p of s.pulls)console.log(`  #${p.number} ${p.state} ${p.head.ref} -> ${p.base.ref}: ${p.title}`);console.log(`  API calls: ${s.calls.length}; POST: ${s.calls.filter(c=>c.startsWith("POST")).length}`)' "$d/github.json"
  first=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1]));if(s.pulls[0])process.stdout.write(s.pulls[0].body)' "$d/github.json")
  if [ -n "$first" ]; then echo "-- body of PR #1:"; printf '%s\n' "$first" | sed 's/^/  | /'; fi
  kill $server
done
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
