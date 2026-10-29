# node:24-slim with the Docker CLI and buildx, both images pinned by digest (as pulled on 2026-10-29).
FROM docker:cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb AS d
FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
COPY --from=d /usr/local/bin/docker /usr/local/bin/docker
COPY --from=d /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
