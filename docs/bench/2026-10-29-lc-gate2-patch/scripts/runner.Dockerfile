FROM docker:cli AS d
FROM node:24-slim
COPY --from=d /usr/local/bin/docker /usr/local/bin/docker
COPY --from=d /usr/local/libexec/docker/cli-plugins/ /usr/local/libexec/docker/cli-plugins/
