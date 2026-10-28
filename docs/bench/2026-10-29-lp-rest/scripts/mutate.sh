#!/usr/bin/env bash
# Breaks one check at a time in a copy of the volume test.sh filled, and runs action.test.ts: each must fail.
# Run on the host after test.sh: bash docs/bench/2026-10-29-lp-rest/scripts/mutate.sh <volume> <log>
set -uo pipefail
vol=$1 log=$2
MSYS_NO_PATHCONV=1 docker run --rm --network none --read-only --tmpfs /tmp:exec --user 1000:1000 -e HOME=/tmp -v "$vol:/src" ludion-c3-test bash -c '
set -u
mutants=(
  "comment.sh reads the artifact before the refusal|action/comment.sh|s#^if \[ \"\$refused\" = \"true\" \]; then#if false; then#"
  "comment.sh skips the head check|action/comment.sh|s#if \[ \"\$current\" != \"\$RUN_HEAD\" \]; then#if false; then#"
  "comment.sh skips the record PR and head check|action/comment.sh|s#if \[ \"\$recorded\" != \"\${pr} \${RUN_HEAD}\" \]; then#if false; then#"
  "body.jq names the record head when refused|action/body.jq|s#(\$head)#(\$r.head_sha)#"
  "read.sh copies no workspace package.json|action/read.sh|s#^done < \"\$INPUT/manifests\"#done < /dev/null#"
  "read.sh lets a .. path through|action/read.sh|s#\*//\*|\*/\./\*|\*/\.\./\*)#*/never/*)#"
  "read.sh reads both sides of an added file|action/read.sh|s#IN(\"added\", \"renamed\", \"copied\")#IN(\"none\")#"
  "judge.yml lets a .. path through|.github/workflows/judge.yml|s#\*//\*|\*/\./\*|\*/\.\./\*) echo#*/never/*) echo#"
  "judge.yml copies no workspace package.json|.github/workflows/judge.yml|s#case \"\$file\" in \*/package.json) ;; \*) continue ;; esac#continue#"
  "the package leaves out LICENSE|packages/cli/package.json|s#    \"LICENSE\",##"
  "start.sh accepts Node 20|action/start.sh|s#< 22)#< 20)#"
)
copy() { rm -rf /tmp/w && mkdir /tmp/w && cd /src && tar --exclude=./node_modules -cf - . | tar -xf - -C /tmp/w && ln -s /src/node_modules /tmp/w/node_modules && cd /tmp/w; }
tests() { npx vitest run --project node packages/cli/test/action.test.ts packages/cli/test/judge-workflow.test.ts > /tmp/out.txt 2>&1; code=$?; counts=$(sed "s/\x1b\[[0-9;]*m//g" /tmp/out.txt | grep -a -E "^ +Tests " | tr -s " "); }
# Unmutated first: a mutant counts as killed only when tests ran and some failed, never on a startup error.
copy; tests; echo "baseline     exit ${code},${counts}"
[ "$code" = 0 ] || { echo "the baseline does not pass; nothing measured"; exit 1; }
survived=0
for m in "${mutants[@]}"; do
  IFS="|" read -r name file expr <<< "$m"
  copy
  cp "$file" /tmp/before && sed -i "$expr" "$file"
  if cmp -s /tmp/before "$file"; then echo "NOT APPLIED  $name"; survived=$((survived+1)); continue; fi
  tests
  if [ "$code" = 0 ]; then echo "SURVIVED     $name"; survived=$((survived+1))
  elif echo "$counts" | grep -q "failed"; then echo "killed       $name:${counts}"
  else echo "ERROR        $name (no test ran)"; survived=$((survived+1)); fi
done
echo "survived: ${survived} of ${#mutants[@]}"
' 2>&1 | tee "$log"
