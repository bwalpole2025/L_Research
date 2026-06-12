import { randomBytes } from 'node:crypto';
import type { AppConfig } from '../config.js';

/**
 * Resolves the vault MASTER KEY. Policy (see docs/decisions.md):
 *   1. OS keychain (preferred) — via the optional `keytar` native module. The
 *      key is generated once and persisted in the login keychain.
 *   2. `CONNECTORS_MASTER_KEY` env var — the fallback for Docker / headless / CI,
 *      where the keychain is unavailable, and for deterministic tests.
 * If neither is available we throw (fail closed) rather than store secrets in
 * the clear.
 *
 * keytar is an OPTIONAL dependency: a failed native build (common in containers)
 * must never block boot, so it is imported dynamically and absence falls through
 * to the env key.
 */

const KEYCHAIN_SERVICE = 'latex-studio';
const KEYCHAIN_ACCOUNT = 'connectors-master-key';

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
export type MasterKeySource = 'env' | 'keychain';

let cached: { key: string; source: MasterKeySource } | null = null;

/**
 * Return the master key (and its source), memoised for the process. Preference:
 * env (explicit override / test / container) → keychain (generate + persist).
 */
export async function resolveMasterKey(config: AppConfig): Promise<{ key: string; source: MasterKeySource }> {
  if (cached) return cached;

  // Explicit env key wins — it's the deliberate Docker/CI/test override.
  const fromEnv = config.connectorsMasterKey.trim();
  if (fromEnv) {
    cached = { key: fromEnv, source: 'env' };
    return cached;
  }

  const keytar = await loadKeytar();
  if (keytar) {
    let key = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (!key) {
      key = randomBytes(32).toString('base64');
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, key);
    }
    cached = { key, source: 'keychain' };
    return cached;
  }

  throw new Error(
    'No vault master key available: the OS keychain (keytar) is unavailable and ' +
      'CONNECTORS_MASTER_KEY is unset. Set CONNECTORS_MASTER_KEY (e.g. `openssl rand -base64 32`) ' +
      'to enable connector credential storage.',
  );
}

/** True when a master key can be resolved (keychain present or env set). */
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
