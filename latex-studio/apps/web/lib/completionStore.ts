'use client';

import { create } from 'zustand';
import type { AiErrorKind, CompletionMode, CompletionResult } from './types';
import type { CompletionConfig } from './completion/types';
import { useAiStore } from './aiStore';

const KEY = 'latex-studio:completions';
const ROLLING = 100;

interface Persisted {
  enabled: boolean;
  perMode: Record<CompletionMode, boolean>;
  debounceMs: number;
  model: string;
  provider: 'agent-sdk' | 'api';
  baseline: boolean;
  accepted: number;
  rejected: number;
}

const DEFAULTS: Persisted = {
  enabled: true,
  perMode: { prose: true, 'inline-math': true, 'display-align': true, preamble: true, 'python-code': true },
  debounceMs: 400,
  model: 'claude-haiku-4-5',
  provider: 'agent-sdk',
  baseline: false,
  accepted: 0,
  rejected: 0,
};

function load(): Persisted {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>), perMode: { ...DEFAULTS.perMode, ...(JSON.parse(raw) as Partial<Persisted>).perMode } };
  } catch {
    return DEFAULTS;
  }
}

function persist(p: Persisted): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode */
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
}

interface CompletionState extends Persisted {
  lastLatencyMs: number | null;
  lastVariant: string | null;
  latencies: number[];
  /** Reason completions are paused (credit/auth/unavailable), or null. */
  pausedReason: AiErrorKind | null;

  config: () => CompletionConfig;
  p95: () => number;
  setEnabled: (v: boolean) => void;
  setModeEnabled: (mode: CompletionMode, v: boolean) => void;
  setDebounce: (ms: number) => void;
  setModel: (m: string) => void;
  setProvider: (p: 'agent-sdk' | 'api') => void;
  setBaseline: (v: boolean) => void;
  recordResult: (res: CompletionResult) => void;
  recordAccept: () => void;
  recordReject: () => void;
  pause: (kind: AiErrorKind) => void;
  resume: () => void;
}

export const useCompletionStore = create<CompletionState>((set, get) => {
  const initial = load();

  function save(): void {
    const s = get();
    persist({
      enabled: s.enabled,
      perMode: s.perMode,
      debounceMs: s.debounceMs,
      model: s.model,
      provider: s.provider,
      baseline: s.baseline,
      accepted: s.accepted,
      rejected: s.rejected,
    });
  }

  return {
    ...initial,
    lastLatencyMs: null,
    lastVariant: null,
    latencies: [],
    pausedReason: null,

    config() {
      const s = get();
      // A credit/auth pause forces enabled off without losing the user's choice.
      return {
        enabled: s.enabled && s.pausedReason === null,
        perMode: s.perMode,
        debounceMs: s.debounceMs,
        model: s.model,
        provider: s.provider,
        baseline: s.baseline,
      };
    },
    p95() {
      return percentile(get().latencies, 95);
    },

    setEnabled(v) {
      set({ enabled: v, pausedReason: v ? null : get().pausedReason });
      save();
    },
    setModeEnabled(mode, v) {
      set((s) => ({ perMode: { ...s.perMode, [mode]: v } }));
      save();
    },
    setDebounce(ms) {
      set({ debounceMs: Math.max(0, Math.min(2000, Math.round(ms))) });
      save();
    },
    setModel(m) {
      set({ model: m });
      save();
    },
    setProvider(p) {
      set({ provider: p });
      save();
    },
    setBaseline(v) {
      set({ baseline: v });
      save();
    },

    recordResult(res) {
      set((s) => ({
        lastLatencyMs: res.latencyMs,
        lastVariant: res.variant,
        latencies: [...s.latencies, res.latencyMs].slice(-ROLLING),
      }));
    },
    recordAccept() {
      set((s) => ({ accepted: s.accepted + 1 }));
      save();
    },
    recordReject() {
      set((s) => ({ rejected: s.rejected + 1 }));
      save();
    },

    pause(kind) {
      set({ pausedReason: kind });
      // Reflect in the shared AI status (chat banner) — the server already marked it.
      void useAiStore.getState().refreshStatus();
    },
    resume() {
      set({ pausedReason: null });
    },
  };
});
