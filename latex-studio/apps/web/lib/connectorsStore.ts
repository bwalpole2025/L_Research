'use client';

import { create } from 'zustand';
import type { ConnectorStatus } from '@latex-studio/shared';
import { api, ApiError } from './api';

/**
 * Client state for the Connectors UI. Talks only to our own api (which holds the
 * bearer token + all third-party secrets); the browser never sees a credential.
 * For OAuth connectors, Connect returns an authUrl we open for consent; the api
 * callback stores the encrypted token and bounces back to /plugins.
 */
interface ConnectorsState {
  connectors: ConnectorStatus[];
  loading: boolean;
  busyId: string | null;
  error: string | null;
  load: () => Promise<void>;
  connect: (id: string, apiKey?: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
}

export const useConnectorsStore = create<ConnectorsState>((set, get) => ({
  connectors: [],
  loading: false,
  busyId: null,
  error: null,

  async load() {
    set({ loading: true, error: null });
    try {
      const { connectors } = await api.listConnectors();
      set({ connectors, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : 'Failed to load connectors' });
    }
  },

  async connect(id, apiKey) {
    set({ busyId: id, error: null });
    try {
      const res = await api.connectConnector(id, apiKey ? { apiKey } : undefined);
      if (res.authUrl) {
        // OAuth: hand off to the provider's consent screen. The api callback
        // stores the token server-side and redirects back to /plugins.
        window.location.href = res.authUrl;
        return;
      }
      if (res.status) {
        set((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? res.status! : c)), busyId: null }));
      } else {
        await get().load();
        set({ busyId: null });
      }
    } catch (err) {
      set({ busyId: null, error: err instanceof ApiError ? err.message : 'Connect failed' });
    }
  },

  async disconnect(id) {
    set({ busyId: id, error: null });
    try {
      const res = await api.disconnectConnector(id);
      if (res.status) {
        set((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? res.status! : c)), busyId: null }));
      } else {
        await get().load();
        set({ busyId: null });
      }
    } catch (err) {
      set({ busyId: null, error: err instanceof ApiError ? err.message : 'Disconnect failed' });
    }
  },
}));
