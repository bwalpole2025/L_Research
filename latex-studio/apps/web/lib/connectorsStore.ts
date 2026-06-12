'use client';

import { create } from 'zustand';
import type { ConnectorStatus } from '@latex-studio/shared';
import { api, ApiError } from './api';

/**
 * Client state for the Connectors UI. Talks only to our own api (which holds the
 * bearer token + all third-party secrets); the browser never sees a credential.
 * For OAuth connectors, Connect opens the provider's consent in a POPUP and polls
 * status until connected — so the studio page never navigates away or gets stuck
 * on "Connecting…", and Google errors stay in the popup, not the app.
 */

function closePopup(popup: Window | null): void {
  try {
    popup?.close();
  } catch {
    /* cross-origin while on the provider — ignore */
  }
}

/**
 * Poll the connector's status until it connects, the popup closes, the attempt is
 * cancelled, or we time out. `stillOurs` lets a Cancel (which clears busyId) stop
 * the loop immediately so the button is never wedged on "Connecting…".
 */
async function waitForOAuth(
  id: string,
  popup: Window | null,
  reload: () => Promise<void>,
  stillOurs: () => boolean,
): Promise<void> {
  const deadline = Date.now() + 3 * 60 * 1000; // give the user 3 min to consent
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    if (!stillOurs()) {
      closePopup(popup); // user pressed Cancel
      return;
    }
    try {
      const status = await api.getConnector(id);
      if (status.connected) {
        closePopup(popup);
        await reload();
        return;
      }
    } catch {
      /* transient — keep polling */
    }
    if (popup?.closed) {
      await reload(); // user closed the popup; reflect whatever state we're in
      return;
    }
  }
  closePopup(popup);
  await reload();
}

interface ConnectorsState {
  connectors: ConnectorStatus[];
  loading: boolean;
  busyId: string | null;
  error: string | null;
  load: () => Promise<void>;
  connect: (id: string, apiKey?: string) => Promise<void>;
  configure: (id: string, clientId: string, clientSecret: string) => Promise<boolean>;
  disconnect: (id: string) => Promise<void>;
  /** Clear an in-flight/stuck busy state so the buttons are pressable again. */
  cancel: () => void;
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
      // Send our origin so the OAuth callback returns us to the SAME origin
      // (localhost vs 127.0.0.1 keep separate sessions).
      const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await api.connectConnector(id, { ...(apiKey ? { apiKey } : {}), ...(origin ? { origin } : {}) });
      if (res.authUrl) {
        // OAuth: open the consent screen in a popup and poll for completion. The
        // api callback stores the encrypted token and closes the popup.
        const popup = window.open(res.authUrl, 'ls-oauth', 'popup,width=520,height=720');
        if (!popup) {
          // Popups blocked → fall back to a full-page redirect.
          window.location.href = res.authUrl;
          return;
        }
        await waitForOAuth(id, popup, () => get().load(), () => get().busyId === id);
        if (get().busyId === id) set({ busyId: null });
        return;
      }
      if (res.status) {
        set((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? res.status! : c)), busyId: null }));
      } else {
        await get().load();
        set({ busyId: null });
      }
    } catch (err) {
      if (get().busyId === id) set({ busyId: null, error: err instanceof ApiError ? err.message : 'Connect failed' });
    }
  },

  cancel() {
    set({ busyId: null });
  },

  async configure(id, clientId, clientSecret) {
    set({ busyId: id, error: null });
    try {
      const res = await api.configureConnector(id, clientId, clientSecret);
      if (res.status) set((s) => ({ connectors: s.connectors.map((c) => (c.id === id ? res.status! : c)), busyId: null }));
      else {
        await get().load();
        set({ busyId: null });
      }
      return true;
    } catch (err) {
      set({ busyId: null, error: err instanceof ApiError ? err.message : 'Save failed' });
      return false;
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
