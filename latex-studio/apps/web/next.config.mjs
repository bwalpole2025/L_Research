/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Two `next dev` instances must NEVER share a build dir (route-manifest
  // corruption → spurious 404s on every route, including /api/*). The Playwright
  // e2e web server sets NEXT_DIST_DIR so its build stays out of the live dev
  // server's .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // @latex-studio/shared is consumed as TypeScript source.
  transpilePackages: ['@latex-studio/shared'],
  // NOTE: browser calls to /api/* are handled by the catch-all Route Handler at
  // app/api/[...path]/route.ts, which forwards to the Fastify api and injects
  // the bearer token server-side. We intentionally do NOT use next.config
  // rewrites for this, because a rewrite cannot add the Authorization header.
};

export default nextConfig;
