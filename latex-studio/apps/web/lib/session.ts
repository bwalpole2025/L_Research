'use client';

/**
 * CONSTRUCTION-PHASE SESSION — a front-end login scaffold, NOT real security.
 * The app remains single-user and locally hosted; the API stays gated by its
 * bearer token. These dummy accounts exist so the login flow, guards and
 * per-user UI can be built now and swapped for real auth later.
 */

export interface Session {
  email: string;
  name: string;
  signedInAt: string;
}

export const DEMO_ACCOUNTS: Array<{ email: string; password: string; name: string; hint: string }> = [
  { email: 'ben@latexstudio.local', password: 'plateau', name: 'Ben Walpole', hint: 'owner' },
  { email: 'demo@latexstudio.local', password: 'demo', name: 'Demo User', hint: 'guest' },
];

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

/** Returns the session on success, null on bad credentials. */
export function signIn(email: string, password: string): Session | null {
  const account = DEMO_ACCOUNTS.find((a) => a.email === email.trim().toLowerCase() && a.password === password);
  if (!account) return null;
  const session: Session = { email: account.email, name: account.name, signedInAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
  return session;
}

export function signOut(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
