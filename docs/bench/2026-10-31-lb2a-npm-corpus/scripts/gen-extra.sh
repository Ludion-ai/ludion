#!/bin/sh
# Runs in Docker only, one image at a time, as gen.sh (docs/decisions/2026-10-31-lock-flags-only.md, section 3).
# MODE=inbundle, in each npm's image: a project that requires npm 10.9.2, a registry package that bundles its
#   dependencies, so the lock has inBundle entries. Output: /out/extra/inbundle/<npm>/v<2|3>/.
# MODE=node-fetch, in npm 12.2.1's image: the review of e9559e4's B1 pair. The base from the project's package.json,
#   then the fix from the base's lock with node-fetch at 2.6.7, twice (the pinned manifest, then the final one, which
#   are the same here), with dependency-patch.ts's npm flags. Output: /out/extra/node-fetch/v<2|3>/{base,fix}/.
set -u
NPM=$(npm -v)
echo "# npm $NPM, node $(node -v), $MODE"
FLAGS="--ignore-scripts --no-audit --no-fund"
PATCH="--allow-git=none --allow-remote=none --allow-file=none --allow-directory=none --registry=https://registry.npmjs.org"
written() { sed -n 's/^  "lockfileVersion": \([0-9]*\),$/\1/p' "$1/package-lock.json" 2>/dev/null; }
for v in 2 3; do
  case "$MODE" in
  inbundle)
    d="/out/extra/inbundle/$NPM/v$v"; mkdir -p "$d"
    printf '%s\n' '{ "name": "s8", "version": "1.0.0", "dependencies": { "npm": "10.9.2" } }' > "$d/package.json"
    # npm 12's default allow-remote is none, and npm reads a bundling package's tarball to list what it bundles: without
    # this, npm 12.2.1 stops with EALLOWREMOTE on the registry's npm-10.9.2.tgz.
    extra=""; [ "${NPM%%.*}" -ge 12 ] && extra="--allow-remote=all"
    (cd "$d" && npm install --package-lock-only $FLAGS $extra --lockfile-version="$v" > npm.log 2>&1; echo $? > npm.exit)
    echo "$NPM v$v inbundle exit $(cat "$d/npm.exit") lockfileVersion $(written "$d") inBundle $(grep -c '"inBundle": true' "$d/package-lock.json")"
    ;;
  node-fetch)
    b="/out/extra/node-fetch/v$v/base"; f="/out/extra/node-fetch/v$v/fix"; mkdir -p "$b" "$f"
    printf '%s\n' '{ "name": "s9", "version": "1.0.0", "dependencies": { "node-fetch": "2.6.1" }, "devDependencies": { "whatwg-url": "5.0.0" } }' > "$b/package.json"
    (cd "$b" && npm install --package-lock-only $FLAGS $PATCH --lockfile-version="$v" > npm.log 2>&1; echo $? > npm.exit)
    cp "$b/package-lock.json" "$f/"
    printf '%s\n' '{ "name": "s9", "version": "1.0.0", "dependencies": { "node-fetch": "2.6.7" }, "devDependencies": { "whatwg-url": "5.0.0" } }' > "$f/package.json"
    (cd "$f" && { npm install --package-lock-only $FLAGS $PATCH && npm install --package-lock-only $FLAGS $PATCH; } > npm.log 2>&1; echo $? > npm.exit)
    echo "$NPM v$v node-fetch base exit $(cat "$b/npm.exit") lockfileVersion $(written "$b"); fix exit $(cat "$f/npm.exit") lockfileVersion $(written "$f")"
    ;;
  esac
done
