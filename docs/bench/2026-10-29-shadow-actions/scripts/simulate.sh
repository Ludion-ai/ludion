#!/usr/bin/env bash
# Runs shadow.yml's own shell steps, cut out of the workflow file, end to end against a local bare repository:
# seed the data branch from a copy of the PC's data, two hourly runs (record, pack, write), then the writer's
# refusals. Git, jq and tar run in a Debian container; the recorder runs through the workflow's own docker command
# (the PC's image by digest), with network, for <seconds> per run. GitHub's API is replaced by a stand-in `gh` that
# answers from the local repository, and actions/checkout by the git commands it runs. Run from the repository root:
#   bash docs/bench/2026-10-29-shadow-actions/scripts/simulate.sh <copy of the PC data dir> <empty dir> [seconds]
set -euo pipefail
export MSYS_NO_PATHCONV=1
PC=$(cd "$1" && pwd) SIM=$(cd "$2" && pwd) SECS=${3:-120}
here=$(cd "$(dirname "$0")" && pwd)
WF=$(pwd)/.github/workflows/shadow.yml
win() { (cd "$1" && (pwd -W 2> /dev/null || pwd)); }
SIMW=$(win "$SIM")
COMMIT=$(sed -n 's/^  RECORDER_COMMIT: //p' "$WF" | tr -d '\r')
IMAGE=$(sed -n 's/^  IMAGE: //p' "$WF" | tr -d '\r')
MAX_BYTES=$(sed -n 's/^  MAX_BYTES: "\(.*\)"/\1/p' "$WF" | tr -d '\r')
TOOLS=ludion-sa-shadow-tools
echo "workflow blob $(git hash-object .github/workflows/shadow.yml), driver blob $(git hash-object .github/shadow/record.ts), recorder ${COMMIT}, ${SECS}s per run"

docker build -q -t "$TOOLS" - > /dev/null << 'DOCKERFILE'
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git jq curl unzip zip ca-certificates openssl > /dev/null \
 && git config --system --add safe.directory '*' && git config --system init.defaultBranch main
DOCKERFILE

# A step's run: script, without its indentation.
block() {
  awk -v name="$1" '
    { sub(/\r$/, "") }
    !found && $0 == "      - name: " name { found = 1; next }
    found && !inrun && /^ +run: \|$/ { inrun = 1; match($0, /^ +/); ri = RLENGTH; next }
    inrun { if ($0 ~ /^ *$/) { print ""; next } match($0, /^ +/); if (RLENGTH <= ri) exit; print substr($0, ri + 3) }
  ' "$WF"
}
# tools <dir under /sim> <script> [NAME=value...]: a script in the Debian container, with the stand-in gh on PATH.
tools() {
  local dir=$1 script=$2; shift 2
  local envs=(); for e in "$@"; do envs+=(-e "$e"); done
  docker run --rm -v "$SIMW:/sim" -w "/sim/$dir" -e PATH=/sim/bin:/usr/local/bin:/usr/bin:/bin "${envs[@]}" "$TOOLS" bash -c "$script"
}
mkdir -p "$SIM/bin"
cp "$here/gh-stand-in.sh" "$SIM/bin/gh"
cp -R "$PC" "$SIM/pc"
cp "$here/seed-data-branch.sh" "$SIM/seed.sh"

echo "== seed the data branch from the PC copy"
tools . "git init -q --bare remote.git && git -C remote.git config uploadpack.allowFilter true"
tools . "bash seed.sh /sim/pc file:///sim/remote.git $COMMIT"
echo "-- a second seed is refused:"
tools . "bash seed.sh /sim/pc file:///sim/remote.git $COMMIT" || echo "exit $?"

# write <dir> <run id> <stamp> <data sha>: actions/checkout for the writer (sparse /state.json, blobless), then its step.
write() {
  local r=$1 id=$2 stamp=$3 sha=$4
  rm -rf "$SIM/$r/w"; mkdir -p "$SIM/$r/w"
  tools "$r/w" "git clone -q --depth 1 --filter=blob:none --no-checkout --branch shadow-data file:///sim/remote.git data && git -C data sparse-checkout set --no-cone /state.json && git -C data checkout -q shadow-data"
  tools "$r/w" "$(block "Check the run's files and commit them")" GH_TOKEN=x REPO=Ludion-ai/ludion RUN_ID="$id" STAMP="$stamp" DATA_SHA="$sha" DATA_BRANCH=shadow-data
}
out() { sed -n "s/^$2=//p" "$SIM/$1/out.record"; }
zipped() { tools "$1" "cp $2 shadow.tar.in 2> /dev/null || true; [ -f shadow.tar.in ] && mv shadow.tar.in shadow.tar; rm -f /sim/artifact.zip && zip -q /sim/artifact.zip shadow.tar"; }

one_run() {
  local n=$1 id=$2 r="run$1"
  mkdir -p "$SIM/$r/app" "$SIM/$r/ludion/.github"
  cp -R .github/shadow "$SIM/$r/ludion/.github/shadow"
  echo "== run $n (run id $id): record job"
  # actions/checkout: the recorder's files at the pinned commit; the data branch, sparse (known/) and blobless. On the
  # runner the checkout belongs to the user the container runs as; here git runs as root, so the sim opens it up.
  git archive "$COMMIT" package.json package-lock.json tools/shadow tools/backtest/src packages/cli/src/security | tar -x -C "$SIM/$r/app"
  tools "$r" "git clone -q --depth 1 --filter=blob:none --sparse --branch shadow-data file:///sim/remote.git data && git -C data sparse-checkout set known && chmod -R a+rwX data"
  touch "$SIM/$r/out.record"
  tools "$r" "$(block 'Read the size of the files stored on the data branch')" GH_TOKEN=x REPO=Ludion-ai/ludion GITHUB_OUTPUT="/sim/$r/out.record"
  tools "$r" "$(block "Add semver from the pinned commit's lockfile, checked against its integrity")"
  docker rm -f ludion-shadow > /dev/null 2>&1 || true
  (cd "$SIM/$r" && GITHUB_WORKSPACE=$(win .) GITHUB_OUTPUT=out.record STORED=$(out "$r" bytes) RUN="$id-1" IMAGE=$IMAGE \
    MAX_BYTES=$MAX_BYTES RECORD_SECONDS=$SECS RECORDER_COMMIT=$COMMIT bash -c "$(block 'Record')")
  docker rm -f ludion-shadow > /dev/null
  tools "$r" "$(block 'Pack what the recorder wrote')" RUN_ID="$id" RUN_ATTEMPT=1 GITHUB_OUTPUT="/sim/$r/out.record"
  tools "$r" "$(block 'Fail unless the recorder reached its deadline')" CODE="$(out "$r" exit)" || echo "(the run would fail here)"
  echo "== run $n: write job"
  zipped "$r" shadow.tar
  write "$r" "$id" "$(out "$r" stamp)" "$(out "$r" data_sha)"
}

one_run 1 1001
one_run 2 1002

echo "== the data branch after two runs"
tools . "git -C remote.git log --format='%h %s' shadow-data
  git -C remote.git ls-tree -r -l shadow-data | awk '{ n++; b += \$4 } \$5 ~ /^runs\/2/ { print \$4, \$5 } END { print n, \"files,\", b, \"bytes\" }'
  for c in \$(git -C remote.git rev-list shadow-data); do git -C remote.git show \$c:state.json | jq -c '{seq, feed_started_at, osv_day, pending: (.pending | length), stopped}'; done
  for f in \$(git -C remote.git ls-tree -r --name-only shadow-data | grep '^runs/2.*/status/'); do git -C remote.git show shadow-data:\$f | jq -c 'select(.type != \"poll\") | del(.node)'; git -C remote.git show shadow-data:\$f | jq -r .type | sort | uniq -c; done"

echo "== refusals"
head=$(tools . "git -C remote.git rev-parse shadow-data")
echo "-- run 2's write again, after the branch moved:"
zipped run2 shadow.tar
write run2 1002 "$(out run2 stamp)" "$(out run2 data_sha)" || echo "exit $?"
echo "-- run 2's artifact under another run id:"
write run2 1003 "$(out run2 stamp)" "$head" || echo "exit $?"
fake="2026-10-29/000000Z-1003-1"
known="known/aa/$(printf 'a%.0s' $(seq 64)).json"
mkdir -p "$SIM/t"
tools t "set -e; mkdir -p d/runs/$fake/status d/.github/workflows d/known/aa; cp /sim/run2/data/state.json d/
  echo '{}' > d/runs/$fake/status/2026-10-29.jsonl; echo x > d/.github/workflows/x.yml
  tar -C d -cf path.tar state.json runs/$fake/status/2026-10-29.jsonl .github/workflows/x.yml
  ln -s /etc/passwd d/$known; tar -C d -cf link.tar state.json $known
  tar -C d -cf ok.tar state.json runs/$fake/status/2026-10-29.jsonl"
echo "-- an artifact holding a path the recorder never writes (.github/workflows/x.yml):"
zipped t path.tar; write t 1003 "$fake" "$head" || echo "exit $?"
echo "-- an artifact holding a symbolic link at a known/ path:"
zipped t link.tar; write t 1003 "$fake" "$head" || echo "exit $?"
echo "-- the same run with only the recorder's paths is accepted:"
zipped t ok.tar; write t 1003 "$fake" "$head"
tools . "git -C remote.git log --format='%h %s' -n 1 shadow-data; echo \".github entries on the branch: \$(git -C remote.git ls-tree -r --name-only shadow-data | grep -c '^\.github' || true)\""
