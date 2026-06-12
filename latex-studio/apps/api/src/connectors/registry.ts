import type { FastifyInstance } from 'fastify';
import type { ConnectorManifest, ConnectorStatus } from '@latex-studio/shared';
import { cliStatus } from '../providers/cli/detect.js';
import { CONNECTORS, getManifest } from './manifest.js';

/**
 * Project the static manifests onto live connection state:
 *  - model (subscriptionCli): connected ⇔ the vendor CLI is installed (login is
 *    owned by the CLI; we surface the sign-in hint). No secret is ever stored.
 *  - oauth2 / apiKey: connected ⇔ a credential exists in the vault. We return
 *    only metadata (scopes, account label, last-used) — never secret material.
 *  - none / not-yet-wired: connected ⇔ wired.
 */
export async function listConnectors(app: FastifyInstance): Promise<ConnectorStatus[]> {
  const metas = await app.vault.listMeta();
  const metaById = new Map(metas.map((m) => [m.connectorId, m]));
  return Promise.all(CONNECTORS.map((m) => statusFor(m, metaById.get(m.id))));
}

export async function connectorStatus(app: FastifyInstance, id: string): Promise<ConnectorStatus | null> {
  const manifest = getManifest(id);
  if (!manifest) return null;
  const meta = await app.vault.meta(id);
  return statusFor(manifest, meta ?? undefined);
}

async function statusFor(
  m: ConnectorManifest,
  meta?: { accountLabel: string | null; scopes: string[]; lastUsedAt: Date | null },
): Promise<ConnectorStatus> {
  const base: ConnectorStatus = {
    id: m.id,
    kind: m.kind,
    name: m.name,
    authType: m.authType,
    scopes: m.scopes,
    capabilities: m.capabilities,
    description: m.description,
    wired: m.wired,
    connected: false,
    scopesGranted: [],
    ...(m.cli ? { cli: m.cli } : {}),
  };

  if (m.authType === 'subscriptionCli' && m.cli) {
    // Anthropic runs through the bundled Agent SDK, so it's usable even when the
    // `claude` CLI isn't separately on PATH; others require their CLI installed.
    const status = await cliStatus(m.cli.command);
    const connected = m.id === 'anthropic' ? true : status.installed;
    return {
      ...base,
      connected,
      ...(status.version ? { accountLabel: `v${status.version}` } : {}),
      detail: status.installed ? m.cli.signInHint : `Not installed — ${m.cli.installHint}`,
    };
  }

  if (m.authType === 'oauth2' || m.authType === 'apiKey') {
    if (!meta) return { ...base, detail: m.wired ? 'Not connected.' : 'Adapter lands in a later milestone.' };
    return {
      ...base,
      connected: true,
      scopesGranted: meta.scopes.length > 0 ? meta.scopes : m.scopes,
      ...(meta.accountLabel ? { accountLabel: meta.accountLabel } : {}),
      ...(meta.lastUsedAt ? { lastUsedAt: meta.lastUsedAt.toISOString() } : {}),
    };
  }

  // authType 'none' (open APIs): usable once wired.
  return { ...base, connected: m.wired, ...(m.wired ? {} : { detail: 'Adapter lands in a later milestone.' }) };
}
