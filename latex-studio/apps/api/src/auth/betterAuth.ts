import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '@prisma/client';
import { isLoopbackHost, type AppConfig } from '../config.js';

/**
 * Better Auth, SELF-HOSTED in our own Postgres (no external auth SaaS, no
 * per-MAU cost). Email+password to start; the `account` table + the commented
 * `socialProviders` block mean an OAuth provider slots in later WITHOUT a
 * rewrite. Sessions are HttpOnly + SameSite cookies (Secure off-loopback) — no
 * tokens in localStorage. The static API_BEARER_TOKEN stays as the separate
 * service-to-service guard (plugins/auth.ts); this is the USER layer on top.
 *
 * Routing: the api mounts the handler at `/auth/*`. The browser calls
 * `/api/auth/*`, which the Next proxy forwards (stripping `/api`, relaying
 * cookies). `auth.api.getSession({ headers })` resolves the session server-side
 * for the ownership guard.
 */
export type Auth = ReturnType<typeof createAuth>;

export function createAuth(prisma: PrismaClient, config: AppConfig) {
  const secure = !isLoopbackHost(config.host);
  return betterAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secret: config.authSecret,
    baseURL: config.webBaseUrl,
    basePath: '/auth',
    trustedOrigins: Array.from(
      new Set([config.webBaseUrl, 'http://localhost:3000', 'http://127.0.0.1:3000']),
    ),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh the cookie at most daily
    },
    advanced: {
      // HttpOnly + SameSite are Better Auth defaults; pin Secure off-loopback so
      // a real (HTTPS) deployment never ships a session cookie over plain HTTP.
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure },
    },
    // OAuth-ready — add providers here later with no other changes:
    // socialProviders: { github: { clientId: …, clientSecret: … } },
  });
}
