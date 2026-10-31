#!/bin/sh
# Runs in Docker only, in one official node image at a time (docs/decisions/2026-10-31-lock-corpus-against-npm.md):
# writes each shape's package-lock.json with npm --package-lock-only --ignore-scripts, at lockfileVersion 2 and 3.
# Output: /out/<npm version>/v<2|3>/<shape>/ (the project, its lock, npm's log and exit code).
# SHAPES="a b" writes only those shapes (the alias shape was added later: docs/decisions/2026-10-31-lock-corpus-alias.md).
set -u
NPM=$(npm -v)
echo "# npm $NPM, node $(node -v)"
project() { # $1 dir, $2 package.json
  mkdir -p "$1" && printf '%s\n' "$2" > "$1/package.json"
}
for v in 2 3; do
  base="/out/$NPM/v$v"
  project "$base/peer-devoptional-alias" '{ "name": "s1", "version": "1.0.0", "dependencies": { "react-dom": "18.2.0", "mkdirp": "0.5.1", "minimist": "1.2.8", "lodash-alias": "npm:lodash@4.17.21" }, "optionalDependencies": { "is-number": "7.0.0" }, "devDependencies": { "to-regex-range": "5.0.1" } }'
  project "$base/overrides" '{ "name": "s2", "version": "1.0.0", "dependencies": { "mkdirp": "0.5.6" }, "overrides": { "minimist": "1.2.5" } }'
  project "$base/nested-overrides" '{ "name": "s3", "version": "1.0.0", "dependencies": { "mkdirp": "0.5.6", "minimist": "^1.2.6" }, "overrides": { "mkdirp@0.5.6": { "minimist": "1.2.5" } } }'
  project "$base/workspaces" '{ "name": "s4", "version": "1.0.0", "workspaces": ["packages/a"], "dependencies": { "is-number": "6.0.0", "local": "file:./local" } }'
  project "$base/workspaces/packages/a" '{ "name": "a", "version": "1.0.0", "dependencies": { "is-number": "7.0.0" }, "devDependencies": { "kind-of": "6.0.3" } }'
  project "$base/workspaces/local" '{ "name": "local", "version": "1.0.0", "dependencies": { "is-buffer": "2.0.5" } }'
  project "$base/bundled" '{ "name": "s5", "version": "1.0.0", "workspaces": ["packages/b"] }'
  project "$base/bundled/packages/b" '{ "name": "b", "version": "1.0.0", "dependencies": { "is-number": "7.0.0" }, "bundleDependencies": ["is-number"] }'
  project "$base/legacy-peer-deps" '{ "name": "s6", "version": "1.0.0", "dependencies": { "react-dom": "18.2.0" } }'
  project "$base/alias" '{ "name": "s7", "version": "1.0.0", "workspaces": ["packages/a"], "dependencies": { "minimist": "npm:left-pad@1.3.0", "mkdirp": "0.5.1", "is-number": "7.0.0" } }'
  project "$base/alias/packages/a" '{ "name": "a", "version": "1.0.0", "dependencies": { "is-number": "npm:left-pad@1.2.0" } }'
  for dir in "$base"/*/; do
    case " ${SHAPES:-$(ls "$base" | tr '\n' ' ')} " in *" $(basename "$dir") "*) ;; *) continue ;; esac
    shape=$(basename "$dir"); extra=""
    [ "$shape" = legacy-peer-deps ] && extra="--legacy-peer-deps"
    (cd "$dir" && npm install --package-lock-only --ignore-scripts --no-audit --no-fund --lockfile-version="$v" $extra > npm.log 2>&1; echo $? > npm.exit)
    written=$(sed -n 's/^  "lockfileVersion": \([0-9]*\),$/\1/p' "$dir/package-lock.json" 2>/dev/null)
    echo "$NPM v$v $shape exit $(cat "$dir/npm.exit") lockfileVersion ${written:-none}"
  done
done
