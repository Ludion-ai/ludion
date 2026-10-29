#!/bin/sh
# Runs the built CLI (patch --apply) on copies of examples/*-security, each committed in its own throwaway repository.
# Usage: e2e.sh <case>...  Cases: npm, npm-two, php, composer, maven.
set -u
sh /scripts/sync.sh
cd /w
echo "# started $(date -u +%Y-%m-%dT%H:%M:%SZ), node $(node -v), $(git --version), $(docker --version)"
npm ci --no-audit --no-fund >/tmp/ci.log 2>&1; echo "npm ci exit $?"
npm run build -w ludion-ai >/tmp/build.log 2>&1; echo "build exit $?"
CLI=/w/packages/cli/dist/cli.js
commit() { git -C "$1" init -q && git -C "$1" add -A && git -C "$1" -c user.name=e2e -c user.email=e2e@example.invalid commit -qm example && echo "committed $(git -C "$1" rev-parse HEAD)"; }
show() {
  dir=$1
  echo "-- branches:"; git -C "$dir" branch --list 'ludion/*' --format='%(refname:short) %(objectname) parent=%(parent)'
  for b in $(git -C "$dir" branch --list 'ludion/*' --format='%(refname:short)'); do echo "-- $b changes:"; git -C "$dir" diff --stat HEAD "$b"; git -C "$dir" log -1 --format='%an <%ae>%n%B' "$b"; done
  echo "-- working tree status (empty means unchanged):"; git -C "$dir" status --porcelain --untracked-files=no
  for receipt in "$dir"/.ludion/security/*.json; do echo "-- receipt $(basename "$receipt"):"; node /scripts/summary.mjs "$receipt"; done
}
for case in "$@"; do
  dir=/e/$case; rm -rf "$dir"; mkdir -p /e
  echo "== case $case"
  case $case in
    npm) cp -r /w/examples/npm-security "$dir" ;;
    npm-two)
      # Two fixes: lodash and minimist. The application's own test pins lodash 4.17.20, so the lodash fix breaks it.
      cp -r /w/examples/npm-security "$dir"
      node -e 'const f=process.argv[1],p=JSON.parse(require("fs").readFileSync(f));p.dependencies.minimist="1.2.5";require("fs").writeFileSync(f,JSON.stringify(p,null,2)+"\n")' "$dir/package.json"
      (cd "$dir" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/tmp/lock.log 2>&1; echo "lockfile exit $?")
      printf '%s\n' "const { test } = require('node:test');" "const assert = require('node:assert/strict');" "test('this application needs lodash 4.17.20 exactly', () => assert.equal(require('lodash/package.json').version, '4.17.20'));" > "$dir/tests/pinned.test.cjs"
      node -e 'const f=process.argv[1],c=JSON.parse(require("fs").readFileSync(f));c.test=["node","--test","tests/smoke.test.cjs","tests/pinned.test.cjs"];require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")' "$dir/ludion.security.json"
      ;;
    php) cp -r /w/examples/php-security "$dir" ;;
    composer) cp -r /w/examples/composer-security "$dir" ;;
    maven) cp -r /w/examples/maven-security "$dir" ;;
  esac
  commit "$dir"
  node "$CLI" patch --dir "$dir" --apply; echo "patch exit $?"
  show "$dir"
  echo "-- second run (the branches exist):"
  node "$CLI" patch --dir "$dir" --apply; echo "patch exit $?"
done
echo "# finished $(date -u +%Y-%m-%dT%H:%M:%SZ)"
