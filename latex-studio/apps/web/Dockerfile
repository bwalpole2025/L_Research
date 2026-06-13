# Production web image. Build context is the repo ROOT (see docker-compose.prod.yml)
# so the pnpm workspace and @latex-studio/shared (consumed as TypeScript source)
# are available. The browser never reaches this directly — Caddy is the only
# published front door; this container is internal-only.
FROM node:20-slim

RUN corepack enable
WORKDIR /repo

# Copy the whole monorepo (node_modules excluded via .dockerignore) and install.
COPY . .
RUN pnpm install --no-frozen-lockfile

WORKDIR /repo/apps/web
# Build the Next.js app. The /api/* proxy route reads API_INTERNAL_URL and
# API_BEARER_TOKEN at REQUEST time (force-dynamic), so no secrets are needed here.
RUN pnpm run build

ENV NODE_ENV=production
# next start binds 0.0.0.0 inside the container's network namespace — it is NOT
# published to the host; only Caddy (on the tunnel interface) can reach it.
EXPOSE 3000
CMD ["pnpm", "run", "start"]
