import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Authenticated symmetric encryption for the credential vault.
 *
 * AES-256-GCM. The 32-byte key is SHA-256 of the master key (so any master-key
 * length works). Each call uses a fresh random IV; the GCM auth tag detects
 * tampering. We store {iv, tag, ciphertext} as base64 — never the plaintext.
 */

export interface EncryptedBlob {
  iv: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

/** Derive the 32-byte AES key from an arbitrary-length master key. */
function deriveKey(masterKey: string | Buffer): Buffer {
  return createHash('sha256').update(masterKey).digest();
}

export function encryptSecret(masterKey: string | Buffer, plaintext: string): EncryptedBlob {
  const key = deriveKey(masterKey);
  // 12 bytes is the recommended nonce length for GCM.
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptSecret(masterKey: string | Buffer, blob: EncryptedBlob): string {
  const key = deriveKey(masterKey);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, 'base64')), decipher.final()]);
  return plaintext.toString('utf8');
}
