# Git from a distribution: docker build --build-arg BASE=ubuntu:22.04 -t rv204-git234 -f git-apt.Dockerfile . (Git 2.34)
ARG BASE
FROM ${BASE}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
