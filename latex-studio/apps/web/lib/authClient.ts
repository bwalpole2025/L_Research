'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Better Auth browser client. It calls `/api/auth/*`, which the Next proxy
 * forwards to the api (relaying the session cookie). The session lives in an
 * HttpOnly cookie the browser sets/clears automatically — it is NEVER readable
 * from JS, so no auth secret ever reaches the frontend.
 */
export const authClient = createAuthClient({
  baseURL: '/api/auth',
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
