# npm 12.2.1, the npm Ludion writes candidates' locks with (dependency-patch.ts), on the node image npm 11.19.1 came in.
# Its registry tarball is checked by SHA-512 before it is installed, with no scripts
# (docs/decisions/2026-10-31-lock-corpus-npm12.md).
FROM node@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
RUN cd /tmp && npm pack npm@12.2.1 --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org \
 && echo "6ca0a6151553fc107e60f1186d9c10d57508dcde6de31292a54d4cc4e8e8ef3de25b3281274657442d7115d10df930bb3794ddcb0681cdfd9d317189abf7b63d  npm-12.2.1.tgz" | sha512sum -c - \
 && npm install --global ./npm-12.2.1.tgz --ignore-scripts --no-audit --no-fund \
 && rm -rf /tmp/npm-12.2.1.tgz /root/.npm \
 && test "$(npm -v)" = 12.2.1
