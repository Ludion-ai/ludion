#!/usr/bin/env bash
# simulate.sh's stand-in for `gh api`: the data branch's tree from the local bare repository, and this run's artifact
# from /sim/artifact.zip. Anything else fails.
set -euo pipefail
case "$*" in
  api\ */git/trees/*)
    sha=${2#*/git/trees/}; sha=${sha%%\?*}
    git -C /sim/remote.git ls-tree -r -l "$sha" | jq -R -s '{truncated: false, tree: [split("\n")[] | select(length > 0)
      | capture("^(?<mode>[0-9]+) (?<type>[a-z]+) (?<sha>[0-9a-f]+) +(?<size>[0-9]+)\t(?<path>.*)$") | .size |= tonumber]}' ;;
  api\ *"artifacts?name=shadow-run"*) echo "1 $(stat -c %s /sim/artifact.zip)" ;;
  api\ */actions/artifacts/1/zip) cat /sim/artifact.zip ;;
  *) echo "gh stand-in: unexpected call: $*" >&2; exit 1 ;;
esac
