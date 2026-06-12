import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { resolveMasterKey } from './keystore.js';

/**
 * Server-side credential vault for connectors. Secrets (OAuth token JSON, or an
 * API key) are stored ONLY as AES-256-GCM ciphertext, keyed by the connector id.
 * `getCredential` is the single decrypt path — it returns plaintext and must
 * never be exposed to a route that serialises to the browser. Model connectors
 * are NOT stored here (their auth is owned by the vendor CLI).
 */

export interface CredentialMeta {
  connectorId: string;
  authType: string;
  accountLabel: string | null;
  scopes: string[];
  lastUsedAt: Date | null;
  updatedAt: Date;
}

export interface StoreInput {
  authType: 'oauth2' | 'apiKey';
  /** The secret to encrypt (serialised to JSON). e.g. an OAuth token set. */
  secret: unknown;
  accountLabel?: string | null;
  scopes?: string[];
}

export class Vault {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  /** Encrypt + upsert a connector's credential. */
  async store(connectorId: string, input: StoreInput): Promise<CredentialMeta> {
    const { key } = await resolveMasterKey(this.config);
    const blob = encryptSecret(key, JSON.stringify(input.secret));
    const row = await this.prisma.credential.upsert({
      where: { connectorId },
      create: {
        connectorId,
        authType: input.authType,
        accountLabel: input.accountLabel ?? null,
        scopes: input.scopes ?? [],
        ciphertext: blob.ciphertext,
        iv: blob.iv,
        tag: blob.tag,
      },
      update: {
        authType: input.authType,
        accountLabel: input.accountLabel ?? null,
        scopes: input.scopes ?? [],
        ciphertext: blob.ciphertext,
        iv: blob.iv,
        tag: blob.tag,
      },
    });
    return toMeta(row);
  }

  /**
   * Decrypt + return the secret (SERVER-SIDE ONLY). null when absent OR when the
   * stored ciphertext can't be decrypted with the current master key (a key
   * change/rotation, or a corrupted row). Returning null rather than throwing
   * keeps the connector usable: it simply reads as "not connected", prompting a
   * reconnect, instead of 500-ing every route.
   */
  async get<T = unknown>(connectorId: string): Promise<T | null> {
    const { key } = await resolveMasterKey(this.config);
    const row = await this.prisma.credential.findUnique({ where: { connectorId } });
    if (!row) return null;
    try {
      return JSON.parse(decryptSecret(key, { iv: row.iv, tag: row.tag, ciphertext: row.ciphertext })) as T;
    } catch {
      return null; // undecryptable (master key changed) → treat as absent
    }
  }

  /** The non-secret metadata for status display (no ciphertext, no plaintext). */
  async meta(connectorId: string): Promise<CredentialMeta | null> {
    const row = await this.prisma.credential.findUnique({ where: { connectorId } });
    return row ? toMeta(row) : null;
  }

  /** All credential metadata, for listing connection status. */
  async listMeta(): Promise<CredentialMeta[]> {
    const rows = await this.prisma.credential.findMany();
    return rows.map(toMeta);
  }

  async has(connectorId: string): Promise<boolean> {
    const row = await this.prisma.credential.findUnique({ where: { connectorId }, select: { id: true } });
    return row !== null;
  }

  /** Delete a connector's credential (disconnect). Idempotent. */
  async delete(connectorId: string): Promise<void> {
    await this.prisma.credential.deleteMany({ where: { connectorId } });
  }

  async touchLastUsed(connectorId: string): Promise<void> {
    await this.prisma.credential.updateMany({ where: { connectorId }, data: { lastUsedAt: new Date() } });
  }
}

function toMeta(row: {
  connectorId: string;
  authType: string;
  accountLabel: string | null;
  scopes: string[];
  lastUsedAt: Date | null;
  updatedAt: Date;
}): CredentialMeta {
  return {
    connectorId: row.connectorId,
    authType: row.authType,
    accountLabel: row.accountLabel,
    scopes: row.scopes,
    lastUsedAt: row.lastUsedAt,
    updatedAt: row.updatedAt,
  };
}
