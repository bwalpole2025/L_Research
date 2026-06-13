import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * ENCRYPTION-AT-REST for document content (TexFile.content + Snapshot payloads).
 *
 * AES-256-GCM with a PER-PROJECT key derived from the vault master key via
 * HKDF-SHA256 (salt = projectId, so each project's key is independent and a
 * single project's key compromise doesn't reveal others). The master key never
 * lives in the database, so a DB-only breach yields only ciphertext. The
 * projectId is also bound in as GCM Additional Authenticated Data, so a row's
 * ciphertext cannot be moved to another project. When a per-user key exists,
 * pass `userId` to scope the derivation further.
 *
 * Stored form: `enc:1:` + base64(iv ‖ tag ‖ ciphertext). The prefix lets us
 * detect already-encrypted values (idempotent migration) and pass plaintext
 * through untouched during the migration window.
 */

const ENC_PREFIX = 'enc:1:';
const IV_LEN = 12; // GCM nonce
const TAG_LEN = 16;

let masterKey: Buffer | null = null;
const keyCache = new Map<string, Buffer>();

/** Initialise the content key from the resolved vault master key (called once at boot). */
export function setContentMasterKey(key: string | Buffer): void {
  masterKey = Buffer.isBuffer(key) ? key : Buffer.from(key, 'utf8');
  keyCache.clear();
}

/** Whether a master key has been set (encryption is active). */
export function contentEncryptionReady(): boolean {
  return masterKey !== null;
}

/** Per-project (optionally per-user) 32-byte AES key, derived + cached. */
function deriveKey(projectId: string, userId?: string | null): Buffer {
  const cacheKey = `${userId ?? ''}::${projectId}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;
  if (!masterKey) throw new Error('content encryption key not initialised');
  const salt = Buffer.from(`ls-content:${userId ?? ''}:${projectId}`, 'utf8');
  const key = Buffer.from(hkdfSync('sha256', masterKey, salt, Buffer.from('latex-studio-content-v1'), 32));
  keyCache.set(cacheKey, key);
  return key;
}

/** True when a value is already in our ciphertext envelope. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

/** Encrypt plaintext for a project. Idempotent: already-encrypted input is returned as-is. */
export function encryptContent(projectId: string, plaintext: string, userId?: string | null): string {
  if (isEncrypted(plaintext)) return plaintext;
  const key = deriveKey(projectId, userId);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(projectId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a value. Non-encrypted (plaintext) input is returned untouched. */
export function decryptContent(projectId: string, value: string, userId?: string | null): string {
  if (!isEncrypted(value)) return value;
  const key = deriveKey(projectId, userId);
  const raw = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(projectId, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
