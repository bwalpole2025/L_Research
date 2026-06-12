import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorStatus } from '@latex-studio/shared';

// Mock the api client the store depends on. vi.hoisted lets the factory (hoisted
// to the top of the module) reference these mocks safely.
const { listConnectors, connectConnector, disconnectConnector } = vi.hoisted(() => ({
  listConnectors: vi.fn(),
  connectConnector: vi.fn(),
  disconnectConnector: vi.fn(),
}));
vi.mock('../lib/api', () => ({
  api: { listConnectors, connectConnector, disconnectConnector },
  ApiError: class ApiError extends Error {},
}));

import { useConnectorsStore } from '../lib/connectorsStore';

const drive: ConnectorStatus = {
  id: 'google-drive',
  kind: 'storage',
  name: 'Google Drive',
  authType: 'oauth2',
  scopes: ['drive.file'],
  capabilities: ['read'],
  description: '',
  wired: true,
  connected: false,
  scopesGranted: [],
};

describe('useConnectorsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectorsStore.setState({ connectors: [], loading: false, busyId: null, error: null });
  });

  it('load() populates connectors', async () => {
    listConnectors.mockResolvedValue({ connectors: [drive] });
    await useConnectorsStore.getState().load();
    expect(useConnectorsStore.getState().connectors).toEqual([drive]);
  });

  it('connect() with an authUrl redirects the browser (OAuth hand-off)', async () => {
    connectConnector.mockResolvedValue({ authUrl: 'https://consent.example/auth' });
    const orig = window.location;
    // jsdom: make location.href assignable without navigating.
    Object.defineProperty(window, 'location', { value: { ...orig, href: '' }, writable: true });
    await useConnectorsStore.getState().connect('google-drive');
    expect((window.location as { href: string }).href).toBe('https://consent.example/auth');
    Object.defineProperty(window, 'location', { value: orig, writable: true });
  });

  it('disconnect() replaces the connector with its refreshed status', async () => {
    useConnectorsStore.setState({ connectors: [{ ...drive, connected: true }] });
    disconnectConnector.mockResolvedValue({ status: { ...drive, connected: false } });
    await useConnectorsStore.getState().disconnect('google-drive');
    expect(useConnectorsStore.getState().connectors[0]!.connected).toBe(false);
    expect(useConnectorsStore.getState().busyId).toBeNull();
  });

  it('cancel() clears a stuck busy state so the buttons are pressable again', () => {
    useConnectorsStore.setState({ busyId: 'google-drive' });
    useConnectorsStore.getState().cancel();
    expect(useConnectorsStore.getState().busyId).toBeNull();
  });
});
