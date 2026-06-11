# Build context is the repo ROOT (see docker-compose.yml) so the pnpm workspace
# and @latex-studio/shared are available.
FROM node:20-slim

# Prisma needs openssl at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

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
