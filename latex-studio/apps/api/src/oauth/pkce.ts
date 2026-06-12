import { createHash, randomBytes } from 'node:crypto';

/**
 * PKCE (RFC 7636) helpers for the authorization-code flow. The verifier is a
 * high-entropy secret kept server-side; only its S256 challenge is sent to the
 * authorization server, so an intercepted auth code cannot be exchanged without
 * the verifier.
 */

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh code verifier: 32 random bytes → 43-char base64url string. */
export function createVerifier(): string {
  return base64url(randomBytes(32));
}

/** The S256 code challenge for a verifier. */
export function challengeFor(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** An opaque anti-CSRF state value tying the redirect back to our request. */
export function randomState(): string {
  return base64url(randomBytes(16));
}
