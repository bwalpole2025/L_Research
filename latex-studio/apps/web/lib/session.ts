'use client';

/**
 * NON-SECRET display profile for the UI chrome (avatar initials, the user's name
 * in the nav). The REAL session is a Better Auth HttpOnly cookie the browser
 * holds and the server validates on every request — it is never readable from JS.
 * This localStorage blob carries only the display name/email; it is NOT an auth
 * token and grants nothing on its own.
 */

export interface Session {
  email: string;
  name: string;
  signedInAt: string;
}

const SESSION_KEY = 'latex-studio:session';

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return parsed.email ? (parsed as Session) : null;
  } catch {
    return null;
  }
}

/** Cache the display profile after a successful Better Auth sign-in. */
export function saveSession(profile: { email: string; name?: string | null }): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ email: profile.email, name: profile.name || profile.email, signedInAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

/** Clear the cached display profile (call alongside Better Auth signOut). */
export function signOut(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
