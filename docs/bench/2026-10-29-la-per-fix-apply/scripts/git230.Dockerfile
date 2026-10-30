# Git 2.30 for the fsmonitor probe: docker build -t rv204-git230 -f git230.Dockerfile .
FROM alpine:3.13
RUN apk add --no-cache git
