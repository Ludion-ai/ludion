set -e
mkdir -p /work && cd /src && tar --exclude=./node_modules --exclude=./.git -cf - . | (cd /work && tar -xf -)
cd /work
git config --global user.email t@example.invalid && git config --global user.name t && git config --global init.defaultBranch main
git init -q && git add -A && git commit -qm snapshot
npm ci --ignore-scripts --no-audit --no-fund > /out/npm-ci.log 2>&1
echo "== typecheck" ; npm run typecheck > /out/typecheck.log 2>&1 && echo typecheck-ok || echo typecheck-FAILED
echo "== build" ; npm run build > /out/build.log 2>&1 && echo build-ok || echo build-FAILED
echo "== test" ; npx vitest run > /out/test.log 2>&1 && echo test-ok || echo test-FAILED
echo "== mutations" ; node /job/mutate-lv4b.mjs > /out/mutate.log 2>&1 && echo mutate-done || echo mutate-FAILED
git status --short > /out/after-mutate-status.txt
