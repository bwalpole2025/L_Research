import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { decryptSecret, encryptSecret } from '../src/vault/crypto.js';
import { resetMasterKeyCache } from '../src/vault/keystore.js';

/**
 * Credential vault: AES-256-GCM round-trip + the encrypted-at-rest guarantee.
 * Requires a reachable Postgres (DATABASE_URL from the repo .env).
 */
const TOKEN = 'test-token';
const MASTER = 'dGVzdC1tYXN0ZXIta2V5LWZvci12YXVsdC11bml0LXRlc3Q='; // base64 test key

describe('vault crypto (AES-256-GCM)', () => {
  it('round-trips a secret and uses a fresh IV each time', () => {
    const a = encryptSecret(MASTER, 'hunter2');
    const b = encryptSecret(MASTER, 'hunter2');
    expect(decryptSecret(MASTER, a)).toBe('hunter2');
    expect(a.iv).not.toBe(b.iv); // random nonce per call
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.ciphertext).not.toContain('hunter2');
  });

  it('fails (throws) when the ciphertext is tampered with', () => {
    const blob = encryptSecret(MASTER, 'secret');
    const tampered = { ...blob, ciphertext: Buffer.from('zzzz').toString('base64') };
    expect(() => decryptSecret(MASTER, tampered)).toThrow();
  });
});

describe('Vault (Prisma-backed)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetMasterKeyCache();
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN, connectorsMasterKey: MASTER } });
    await app.ready();
  });
  beforeEach(async () => {
    await app.prisma.credential.deleteMany({ where: { connectorId: 'vault-test' } });
  });
  afterAll(async () => {
    await app.prisma.credential.deleteMany({ where: { connectorId: 'vault-test' } });
    await app.close();
  });

  it('stores the secret as ciphertext (never plaintext) and decrypts it back', async () => {
    await app.vault.store('vault-test', { authType: 'oauth2', secret: { accessToken: 'TOP-SECRET-TOKEN' }, scopes: ['s1'] });

    // The raw DB row must not contain the plaintext anywhere.
    const row = await app.prisma.credential.findUnique({ where: { connectorId: 'vault-test' } });
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain('TOP-SECRET-TOKEN');
    expect(row!.ciphertext.length).toBeGreaterThan(0);

    // Server-side decrypt returns the original.
    const got = await app.vault.get<{ accessToken: string }>('vault-test');
    expect(got?.accessToken).toBe('TOP-SECRET-TOKEN');

    // Metadata exposes scopes but no secret.
    const meta = await app.vault.meta('vault-test');
    expect(meta?.scopes).toEqual(['s1']);
    expect(JSON.stringify(meta)).not.toContain('TOP-SECRET-TOKEN');
  });

  it('delete removes the credential (disconnect)', async () => {
    await app.vault.store('vault-test', { authType: 'apiKey', secret: { apiKey: 'k' } });
    expect(await app.vault.has('vault-test')).toBe(true);
    await app.vault.delete('vault-test');
    expect(await app.vault.has('vault-test')).toBe(false);
    expect(await app.vault.get('vault-test')).toBeNull();
  });
});
