/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @latex-studio/shared is consumed as TypeScript source.
  transpilePackages: ['@latex-studio/shared'],
  // NOTE: browser calls to /api/* are handled by the catch-all Route Handler at
  // app/api/[...path]/route.ts, which forwards to the Fastify api and injects
  // the bearer token server-side. We intentionally do NOT use next.config
  // rewrites for this, because a rewrite cannot add the Authorization header.
};

export default nextConfig;
