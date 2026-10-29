# node:24-slim with git (ludion-l9-node24-git) and the Docker CLI with buildx, to run the built CLI against the examples.
# The CLI reaches the host's Docker through the mounted socket, as it would on a developer's machine.
FROM docker:27-cli AS docker
FROM ludion-l9-node24-git
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
