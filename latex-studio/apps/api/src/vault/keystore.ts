import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../config.js';

/**
 * Resolves the vault MASTER KEY. Order (see docs/decisions.md):
 *   1. `CONNECTORS_MASTER_KEY` env var — explicit override for Docker / CI / a
 *      deterministic deployment, and for tests.
 *   2. A persisted key FILE (`~/.latex-studio/connectors-master-key`, mode 0600).
 *      This is the reliable, headless-safe default: read with plain `fs`, it has
 *      none of the OS-keychain's interactive-prompt fragility in a background dev
 *      server (which made it intermittently unavailable and 500 the routes).
 *   3. First run only: seed the file from the OS keychain when it's available
 *      (so an existing keychain key is honoured), else generate a fresh key. The
 *      key is then written to the file so EVERY later resolve is deterministic
 *      and prompt-free.
 *
 * The key never leaves the server and is never logged. keytar stays an OPTIONAL
 * dependency — when present it's used to seed/back up the key, but the file makes
 * the vault work even when it isn't.
 */

const KEYCHAIN_SERVICE = 'latex-studio';
const KEYCHAIN_ACCOUNT = 'connectors-master-key';
const KEY_FILE = join(homedir(), '.latex-studio', 'connectors-master-key');

type Keytar = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
};

let keytarLoaded = false;
let keytarMod: Keytar | null = null;

async function loadKeytar(): Promise<Keytar | null> {
  if (keytarLoaded) return keytarMod;
  keytarLoaded = true;
  try {
    // Dynamic + non-literal specifier so a missing/unbuildable optional native
    // module degrades gracefully and never breaks the build (it isn't typed).
    const specifier = 'keytar';
    const mod = (await import(specifier)) as { default?: Keytar } & Keytar;
    keytarMod = (mod.default ?? mod) as Keytar;
  } catch {
    keytarMod = null;
  }
  return keytarMod;
}

/** Where the resolved master key came from (for status/diagnostics only). */
export type MasterKeySource = 'env' | 'keychain' | 'file';

let cached: { key: string; source: MasterKeySource } | null = null;

function readKeyFile(): string | null {
  try {
    if (existsSync(KEY_FILE)) return readFileSync(KEY_FILE, 'utf8').trim() || null;
  } catch {
    /* unreadable — fall through */
  }
  return null;
}

function writeKeyFile(key: string): void {
  try {
    mkdirSync(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    writeFileSync(KEY_FILE, key, { mode: 0o600 });
  } catch {
    /* best-effort; if it fails we still return the in-memory key this run */
  }
}

/**
 * Return the master key (and its source), memoised for the process. Always
 * succeeds (it will generate + persist a key if needed), so the vault is never
 * unavailable on a localhost run.
 */
export async function resolveMasterKey(config: AppConfig): Promise<{ key: string; source: MasterKeySource }> {
  if (cached) return cached;

  // 1. Explicit env key (deliberate override — Docker / CI / test).
  const fromEnv = config.connectorsMasterKey.trim();
  if (fromEnv) {
    cached = { key: fromEnv, source: 'env' };
    return cached;
  }

  // 2. Persisted file — the stable, prompt-free default.
  const fromFile = readKeyFile();
  if (fromFile) {
    cached = { key: fromFile, source: 'file' };
    return cached;
  }

  // 3a. First run: honour an existing keychain key if we can read one.
  const keytar = await loadKeytar();
  if (keytar) {
    try {
      const existing = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
      if (existing) {
        writeKeyFile(existing); // stabilise: future resolves read the file, not the keychain
        cached = { key: existing, source: 'keychain' };
        return cached;
      }
    } catch {
      /* keychain unavailable in this (headless) process — fall through to a file key */
    }
  }

  // 3b. Generate, persist to the file (+ best-effort keychain backup), use.
  const key = randomBytes(32).toString('base64');
  writeKeyFile(key);
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key);
    } catch {
      /* best-effort */
    }
  }
  cached = { key, source: 'file' };
  return cached;
}

/** True when a master key can be resolved — now always true on a real run. */
export async function masterKeyAvailable(config: AppConfig): Promise<boolean> {
  try {
    await resolveMasterKey(config);
    return true;
  } catch {
    return false;
  }
}

/** Test seam: drop the memoised key so a different config takes effect. */
export function resetMasterKeyCache(): void {
  cached = null;
}
