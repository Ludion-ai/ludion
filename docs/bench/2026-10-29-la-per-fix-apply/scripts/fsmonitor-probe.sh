#!/bin/sh
# Before Git 2.36, core.fsmonitor is a hook path: does -c core.fsmonitor=false run a program named "false" found on PATH
# in the project? Git runs the hook in the work tree, so "." on PATH finds a "false" the project commits.
# Run with --network none, on a scratch repository made here. "RAN" means the project's "false" ran.
set -u
W=/tmp/f; rm -rf $W; mkdir -p $W/repo; cd $W/repo
echo "== $(git --version)"
T() { git -c user.name=t -c user.email=t@t.invalid -c commit.gpgSign=false "$@"; }
T init -q .; printf '{}\n' > a; printf '#!/bin/sh\ntouch %s/RAN\nexit 1\n' $W > false; chmod +x false; T add -A; T commit -qm one
for v in false ""; do
  rm -f $W/RAN; I=$(mktemp -d)/index
  ( cd /tmp && PATH=".:$PATH" GIT_INDEX_FILE=$I git -C $W/repo -c "core.fsmonitor=$v" read-tree HEAD \
    && PATH=".:$PATH" GIT_INDEX_FILE=$I git -C $W/repo -c "core.fsmonitor=$v" update-index --add --cacheinfo 100644 "$(git -C $W/repo rev-parse HEAD:a)" b \
    && PATH=".:$PATH" GIT_INDEX_FILE=$I git -C $W/repo -c "core.fsmonitor=$v" write-tree >/dev/null )
  echo "   -c core.fsmonitor='$v': $( [ -e $W/RAN ] && echo RAN || echo 'not run')"
done
