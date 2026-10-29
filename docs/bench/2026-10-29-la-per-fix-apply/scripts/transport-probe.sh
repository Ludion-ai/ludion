#!/bin/sh
# Does a repository's protocol.file.allow=always open a lazy fetch that -c protocol.allow=never alone would block?
# Run with --network none, on scratch repositories made here. "RAN" means the repository's uploadpack command ran.
set -u
export GIT_AUTHOR_NAME=a GIT_AUTHOR_EMAIL=a@a GIT_COMMITTER_NAME=a GIT_COMMITTER_EMAIL=a@a
git --version
mkdir -p /tmp/o && cd /tmp/o && git init -q -b main && echo hi > a.txt && git add a.txt && git commit -qm one
C=$(git rev-parse HEAD)
setup() { rm -rf /tmp/p; mkdir -p /tmp/p && cd /tmp/p && git init -q -b main; printf '%s\n' "$C" > .git/refs/heads/main
  git config core.repositoryformatversion 1; git config extensions.partialClone origin; git config remote.origin.url /tmp/o
  git config remote.origin.promisor true; git config protocol.file.allow always
  git config remote.origin.uploadpack "touch /tmp/RAN; git-upload-pack"; rm -f /tmp/RAN; cd /; }
try() { name=$1; shift; setup; "$@" >/dev/null 2>&1; [ -e /tmp/RAN ] && echo "$name: RAN" || echo "$name: not run"; }
P="file ext ssh git http https"; PER=""; for p in $P; do PER="$PER -c protocol.$p.allow=never"; done
try "plain git" git -C /tmp/p rev-parse --verify --quiet 'HEAD^{commit}'
try "-c protocol.allow=never only" git -C /tmp/p -c protocol.allow=never rev-parse --verify --quiet 'HEAD^{commit}'
try "-c protocol.allow=never and each protocol.<name>.allow=never" git -C /tmp/p -c protocol.allow=never $PER rev-parse --verify --quiet 'HEAD^{commit}'
try "GIT_NO_LAZY_FETCH=1 only" env GIT_NO_LAZY_FETCH=1 git -C /tmp/p rev-parse --verify --quiet 'HEAD^{commit}'
try "GIT_ALLOW_PROTOCOL=none only" env GIT_ALLOW_PROTOCOL=none git -C /tmp/p rev-parse --verify --quiet 'HEAD^{commit}'
