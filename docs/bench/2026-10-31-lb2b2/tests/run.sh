#!/bin/bash
# LB2b2 harness for action/check.sh. Mounted at /t: /t/trial/action-branch is a copy of ludion-trial's ludion-action
# branch, /t/test holds the scan answers of this folder (php.json, php-fixed.json, npm.json, npm-fixed.json).
# Run: docker run --rm --memory 512m -v <dir>:/t --entrypoint sh alpine:3.20 /t/test/h/cases.sh
# harness: stub node (scan) and gh; MAINRC/MAINOUT, HEADRC/HEADOUT choose the answers
set -u
A=/t/trial/action-branch
mkdir -p /tmp/bin
cat > /tmp/bin/node <<'N'
#!/bin/bash
case "$4" in */head/*) f=$HEADOUT; rc=$HEADRC;; *) f=$MAINOUT; rc=$MAINRC;; esac
[ -n "$f" ] && cat "$f"; exit $rc
N
cat > /tmp/bin/gh <<'G'
#!/bin/bash
case "$*" in
  *pulls*) echo "7 $(printf 'a%.0s' {1..40}) o/r github-actions[bot] ludion/x/php/1";;
  *compare/*...a*) echo "1 $(printf 'b%.0s' {1..40})";;
  *compare/b*) printf "${MOVED:-1\nother/file\n}";;
  *tarball*) mkdir -p /tmp/tb/top/php && tar -czf - -C /tmp/tb top;;
esac
G
chmod +x /tmp/bin/*
export PATH=/tmp/bin:$PATH GITHUB_ACTION_PATH=$A CLI=x PROJECT=/p REPO=o/r GITHUB_SHA=$(printf 'c%.0s' {1..40})
export RUNNER_TEMP=$(mktemp -d) GITHUB_OUTPUT=/dev/null GITHUB_STEP_SUMMARY=/dev/null
bash $A/action/check.sh 2>&1 | grep -E "work=|not counted|cannot" | sed "s/^/  /"
