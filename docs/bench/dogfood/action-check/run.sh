#!/usr/bin/env bash
# The action check: builds the release bundle, packs the npm package, and runs action.yml's scripts for both modes
# against PR #161's files (prepare.sh), with gh replaced by gh-stub.sh so nothing is sent to GitHub. The judge itself
# reads the public npm registry and OSV, as it does in CI. Runs inside a container, from a copy of the repository:
#   docker run --rm -v <repo>:/src:ro -v <fixtures>:/fixtures:ro -v <out>:/out node:24-slim bash /src/docs/bench/dogfood/action-check/run.sh
set -uo pipefail
step() { printf '\n== %s\n' "$*"; }
fail=0
check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }

apt-get update -qq > /dev/null && apt-get install -y -qq jq unzip zip > /dev/null || exit 1
mkdir -p /work && (cd /src && tar --exclude=node_modules --exclude=./.git -cf - .) | tar -xf - -C /work || exit 1
cd /work

step "build: npm ci, the CLI bundle and the action's record bundle"
npm ci --ignore-scripts --no-audit --no-fund > /out/npm-ci.log 2>&1 || { echo "npm ci failed"; exit 1; }
npm run build -w ludion-ai || exit 1
node action/build.ts || exit 1
node --version
sha256sum packages/cli/dist/cli.js action/dist/record.js | tee /out/bundle-sha256.txt
mkdir -p /out/bundle && cp packages/cli/dist/cli.js action/dist/record.js /out/bundle/

step "npm pack"
(cd packages/cli && npm pack --dry-run --json > /out/npm-pack-dry-run.json 2> /out/npm-pack-dry-run.stderr && npm pack --pack-destination /out > /dev/null) || exit 1
tar -tzf /out/ludion-ai-*.tgz | LC_ALL=C sort | tee /out/npm-pack-files.txt
check "the package is LICENSE, README.md, dist/cli.js and package.json" '[ "$(cat /out/npm-pack-files.txt)" = "$(printf "package/LICENSE\npackage/README.md\npackage/dist/cli.js\npackage/package.json")" ]'
tar -tvzf /out/ludion-ai-*.tgz | awk '{print $1, $6}' | LC_ALL=C sort -k2 | tee /out/npm-pack-modes.txt
check "every packed file is -rw-r--r--" '[ "$(cut -d" " -f1 /out/npm-pack-modes.txt | sort -u)" = "-rw-r--r--" ]'
check "the license is the repository's" 'cmp -s LICENSE packages/cli/LICENSE'

step "npm pack, again after marking the packed files executable (as a copy from a Windows checkout has them)"
chmod 0755 packages/cli/LICENSE packages/cli/README.md packages/cli/package.json packages/cli/dist/cli.js
npm run build -w ludion-ai > /dev/null || exit 1
mkdir -p /out/again && (cd packages/cli && npm pack --dry-run --json > /out/npm-pack-again-dry-run.json 2> /dev/null && npm pack --pack-destination /out/again > /dev/null) || exit 1
sha256sum /out/ludion-ai-*.tgz /out/again/ludion-ai-*.tgz | tee /out/npm-pack-tarballs-sha256.txt
check "the same tarball, byte for byte" 'cmp -s /out/ludion-ai-*.tgz /out/again/ludion-ai-*.tgz'
check "the same integrity" '[ "$(jq -r ".[0].integrity" /out/npm-pack-dry-run.json)" = "$(jq -r ".[0].integrity" /out/npm-pack-again-dry-run.json)" ]'

mkdir -p /stub && cp docs/bench/dogfood/action-check/gh-stub.sh /stub/gh && chmod +x /stub/gh
export PATH="/stub:$PATH" GH_TOKEN=stub GITHUB_ACTION_PATH=/work REPO=Ludion-ai/ludion
. /fixtures/shas.env
fresh() {
  rm -rf /fx /runner && cp -r /fixtures /fx && mkdir -p /runner
  export FIXTURES=/fx RUNNER_TEMP=/runner GITHUB_OUTPUT=/runner/output GITHUB_STEP_SUMMARY=/runner/summary
  : > /runner/output
}
judge_mode() { # $1: event
  MODE=judge EVENT=$1 RECORD=/runner/ludion/judgement.json PR=161 HEAD_SHA=$HEAD_SHA BASE_SHA=$BASE_SHA MERGE_SHA=$MERGE_SHA bash action/start.sh || return 1
  read=success
  INPUT=/runner/ludion/input HEAD_SHA=$HEAD_SHA MERGE_SHA=$MERGE_SHA BASE_REF=main bash action/read.sh || read=failure
  base=$(sed -n 's/^base=//p' /runner/output)
  RECORD=/runner/ludion/judgement.json INPUT=/runner/ludion/input STARTED_AT=$(sed -n 's/^at=//p' /runner/output) PR=161 \
    HEAD_SHA=$HEAD_SHA BASE_SHA=${base:-$BASE_SHA} MERGE_SHA=$MERGE_SHA BUILD_OUTCOME=success READ_OUTCOME=$read node action/dist/record.js
}

step "mode judge on PR #161"
fresh
judge_mode pull_request > /out/judge-mode.log 2>&1; code=$?
cat /out/judge-mode.log
cp /runner/ludion/judgement.json /out/judge-mode-judgement.json
check "record.js exits 0 (a judgement)" '[ $code = 0 ]'
check "the verdict is stop" '[ "$(jq -r .verdict /out/judge-mode-judgement.json)" = stop ]'
check "the changed files are the two the merge changes" '[ "$(tr "\0" " " < /runner/ludion/input/files)" = "apps/worker/package.json package-lock.json " ]'
check "the changed workspace package.json is read on both sides" 'cmp -s /runner/ludion/input/before/apps/worker/package.json "/fx/$(printf "%s" "repos/${REPO}/contents/apps/worker/package.json?ref=${BASE_SHA}" | tr -c "A-Za-z0-9._-" "_")" && cmp -s /runner/ludion/input/after/apps/worker/package.json "/fx/$(printf "%s" "repos/${REPO}/contents/apps/worker/package.json?ref=${MERGE_SHA}" | tr -c "A-Za-z0-9._-" "_")"'
check "the record matches valid.jq" 'jq -e -s -f action/valid.jq /out/judge-mode-judgement.json > /dev/null'

step "mode comment: first post"
cd /runner/ludion && zip -q /tmp/artifact.zip judgement.json && cd /work
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_'; }
comment_fixtures() { # $1: the compare answer's files
  printf '{"artifacts":[{"id":7,"size_in_bytes":%s,"expired":false,"created_at":"2026-10-28T00:00:00Z"}]}\n' "$(stat -c %s /tmp/artifact.zip)" > "/fx/$(key "repos/${REPO}/actions/runs/1/artifacts?name=ludion-judgement")"
  cp /tmp/artifact.zip "/fx/$(key "repos/${REPO}/actions/artifacts/7/zip")"
  printf '[{"number":161,"state":"open","head":{"sha":"%s","ref":"dependabot/npm_and_yarn/hono-4.13.14","repo":{"full_name":"%s"}},"base":{"ref":"main"}}]\n' "$HEAD_SHA" "$REPO" > "/fx/$(key "repos/${REPO}/pulls")"
  printf '{"files":%s}\n' "$1" > "/fx/$(key "repos/${REPO}/compare/main...${HEAD_SHA}")"
  echo '[]' > "/fx/$(key "repos/${REPO}/issues/161/comments")"
}
comment_mode() {
  JUDGE_WORKFLOW=.github/workflows/ludion-judge.yml RUN_EVENT=pull_request RUN_PATH=${RUN_PATH:-.github/workflows/ludion-judge.yml} RUN_ID=1 RUN_HEAD=$HEAD_SHA \
    RUN_REPO=$REPO RUN_OWNER=Ludion-ai DEFAULT_BRANCH=main RUN_BRANCH=dependabot/npm_and_yarn/hono-4.13.14 RUN_URL=https://github.com/Ludion-ai/ludion/actions/runs/1 CONCLUSION=success \
    bash action/comment.sh
}
SAFE='[{"filename":"apps/worker/package.json"},{"filename":"package-lock.json"}]'
rm -rf /fx && cp -r /fixtures /fx && comment_fixtures "$SAFE"
comment_mode; code=$?
check "exit 0" '[ $code = 0 ]'
check "one POST to issues/161/comments" '[ -f /fx/written-1-POST.json ] && grep -q "^POST repos/${REPO}/issues/161/comments$" /fx/calls.log'
jq -r .body /fx/written-1-POST.json > /out/comment-first.md
check "the comment starts with the marker and the preview line" '[ "$(head -2 /out/comment-first.md)" = "$(printf "<!-- ludion-judge -->\n**プレビュー：コメントのみ。マージは行わない。** Preview: comments only; nothing is merged.")" ]'
check "the comment names the verdict 停止 (stop)" 'grep -q "判定: \*\*停止\*\*（\`stop\`）" /out/comment-first.md'
check "the judge text is indented" 'grep -q "^    Ludion judgement: STOP" /out/comment-first.md'

step "mode comment: a re-judgement updates the same comment"
echo '[{"id":42,"user":{"login":"github-actions[bot]"},"body":"<!-- ludion-judge -->\nearlier"},{"id":43,"user":{"login":"someone"},"body":"<!-- ludion-judge -->\nnot ours"}]' > "/fx/$(key "repos/${REPO}/issues/161/comments")"
comment_mode; code=$?
check "exit 0" '[ $code = 0 ]'
check "one PATCH of comment 42, no second POST" '[ -f /fx/written-2-PATCH.json ] && grep -q "^PATCH repos/${REPO}/issues/comments/42$" /fx/calls.log && [ "$(grep -c "^POST" /fx/calls.log)" = 1 ]'

step "mode comment: a head that changes .github/ is refused"
rm -rf /fx && cp -r /fixtures /fx && comment_fixtures '[{"filename":"package-lock.json"},{"filename":".github/workflows/ludion-judge.yml"}]'
comment_mode; code=$?
jq -r .body /fx/written-1-POST.json > /out/comment-refused.md
check "exit 0, posted as 判定不能 without the judge's text" '[ $code = 0 ] && grep -q "判定: \*\*判定不能\*\*" /out/comment-refused.md && ! grep -q "Ludion judgement" /out/comment-refused.md'
check "the artifact was never listed or downloaded" '! grep -q "artifacts" /fx/calls.log'
check "the PR was found from GitHub, then the head's changes read, in that order" '[ "$(grep -n -m1 "^GET repos/${REPO}/pulls$" /fx/calls.log | cut -d: -f1)" = 1 ] && [ "$(grep -n -m1 "/compare/main\.\.\." /fx/calls.log | cut -d: -f1)" = 2 ]'

step "mode comment: a record that does not match the schema is not posted"
rm -rf /fx && cp -r /fixtures /fx && mkdir -p /tmp/bad && jq '.verdict = "ready_except_build"' /runner/ludion/judgement.json > /tmp/bad/judgement.json
(cd /tmp/bad && rm -f /tmp/artifact.zip && zip -q /tmp/artifact.zip judgement.json) && comment_fixtures "$SAFE"
comment_mode; code=$?
check "exit 1, nothing written" '[ $code = 1 ] && ! ls /fx/written-* > /dev/null 2>&1'

step "mode comment: another workflow's run is not posted"
RUN_PATH=.github/workflows/other.yml comment_mode; code=$?
check "exit 1, nothing written" '[ $code = 1 ] && ! ls /fx/written-* > /dev/null 2>&1'

step "mode judge: a file the API cannot give makes the record undecidable"
fresh
rm "/fx/$(key "repos/${REPO}/contents/package-lock.json?ref=${MERGE_SHA}")"
judge_mode pull_request > /out/judge-mode-read-failure.log 2>&1; code=$?
check "record.js exits 1, verdict undecidable, reason names the read" '[ $code = 1 ] && [ "$(jq -r .verdict /runner/ludion/judgement.json)" = undecidable ] && jq -r .reason /runner/ludion/judgement.json | grep -q "could not be read"'

step "mode judge: pull_request_target is refused"
fresh
judge_mode pull_request_target > /out/judge-mode-target.log 2>&1; code=$?
check "start.sh fails, no record" '[ $code = 1 ] && [ ! -f /runner/ludion/judgement.json ]'

step "result"
if [ $fail = 0 ]; then echo "all checks passed"; else echo "some checks failed"; fi
exit $fail
