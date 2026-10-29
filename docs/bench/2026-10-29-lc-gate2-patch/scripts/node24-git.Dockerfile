# The recipe of the local image ludion-l9-node24-git, as `docker history` shows it (L9 built it on 2026-10-28 and did
# not keep its Dockerfile): the node:24-slim image created on 2026-10-21, with git added. Build: docker build -t ludion-l9-node24-git -f node24-git.Dockerfile .
FROM node:24-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
