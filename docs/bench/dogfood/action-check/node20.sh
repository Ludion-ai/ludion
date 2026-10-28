#!/usr/bin/env bash
# Runs action.yml's mode judge scripts on Node 20 (the floor start.sh accepts), with the bundles run.sh built and gh
# stubbed, against prepare.sh's fixtures:
#   docker run --rm -v <repo>:/src:ro -v <fixtures>:/fixtures:ro -v <run.sh's out/bundle>:/bundle:ro node:20.19.2-bookworm bash /src/docs/bench/dogfood/action-check/node20.sh
set -uo pipefail
apt-get update -qq > /dev/null && apt-get install -y -qq jq > /dev/null || exit 1
mkdir -p /work && (cd /src && tar --exclude=node_modules --exclude=./.git -cf - .) | tar -xf - -C /work || exit 1
cd /work && mkdir -p action/dist packages/cli/dist && cp /bundle/record.js action/dist/ && cp /bundle/cli.js packages/cli/dist/
sha256sum packages/cli/dist/cli.js action/dist/record.js
node --version
mkdir -p /stub && cp docs/bench/dogfood/action-check/gh-stub.sh /stub/gh && chmod +x /stub/gh
cp -r /fixtures /fx && mkdir -p /runner && : > /runner/output
export PATH="/stub:$PATH" GH_TOKEN=stub REPO=Ludion-ai/ludion FIXTURES=/fx RUNNER_TEMP=/runner GITHUB_OUTPUT=/runner/output
. /fixtures/shas.env
MODE=judge EVENT=pull_request RECORD=/runner/ludion/judgement.json PR=161 HEAD_SHA=$HEAD_SHA BASE_SHA=$BASE_SHA MERGE_SHA=$MERGE_SHA bash action/start.sh || exit 1
INPUT=/runner/ludion/input HEAD_SHA=$HEAD_SHA MERGE_SHA=$MERGE_SHA BASE_REF=main bash action/read.sh || exit 1
RECORD=/runner/ludion/judgement.json INPUT=/runner/ludion/input STARTED_AT=$(sed -n 's/^at=//p' /runner/output) PR=161 \
  HEAD_SHA=$HEAD_SHA BASE_SHA=$(sed -n 's/^base=//p' /runner/output) MERGE_SHA=$MERGE_SHA BUILD_OUTCOME=success READ_OUTCOME=success node action/dist/record.js
code=$?
echo "record.js exit ${code}"
jq -e -s -f action/valid.jq /runner/ludion/judgement.json > /dev/null && echo "schema ok" || { echo "schema FAIL"; exit 1; }
[ "$code" = 0 ] && [ "$(jq -r .verdict /runner/ludion/judgement.json)" = stop ] && echo "ok   Node 20: verdict stop, as on Node 24" || { echo "FAIL"; exit 1; }
