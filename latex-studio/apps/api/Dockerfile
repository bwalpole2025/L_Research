# Build context is the repo ROOT (see docker-compose.yml) so the pnpm workspace
# and @latex-studio/shared are available.
FROM node:20-slim

# Prisma needs openssl at runtime; curl fetches the static docker CLI below.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# The api drives compilation by `docker exec`-ing into the texlive container and
# `docker run`-ning the pyrun sandbox, so it needs the docker CLI (the daemon
# socket is bind-mounted by compose). Static binary → works on amd64 AND arm64.
ARG DOCKER_CLI_VERSION=27.3.1
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in amd64) d=x86_64 ;; arm64) d=aarch64 ;; *) echo "unsupported arch: $arch" >&2; exit 1 ;; esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${d}/docker-${DOCKER_CLI_VERSION}.tgz" -o /tmp/docker.tgz; \
    tar -xzf /tmp/docker.tgz -C /tmp docker/docker; \
    install -m 0755 /tmp/docker/docker /usr/local/bin/docker; \
    rm -rf /tmp/docker /tmp/docker.tgz; \
    docker --version

RUN corepack enable
WORKDIR /repo

# Copy the whole monorepo (node_modules excluded via .dockerignore) and install.
COPY . .
RUN pnpm install --no-frozen-lockfile

WORKDIR /repo/apps/api
RUN pnpm exec prisma generate

ENV API_HOST=0.0.0.0
ENV API_PORT=4000
EXPOSE 4000

# Run via tsx (the api consumes @latex-studio/shared as TypeScript source).
CMD ["pnpm", "run", "start"]
