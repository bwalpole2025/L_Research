import type { CompletionInlineRequest, CompletionMode, CompletionResult } from '../types';

export type { CompletionMode };

/** Client-side completion configuration (persisted to localStorage). */
export interface CompletionConfig {
  enabled: boolean;
  perMode: Record<CompletionMode, boolean>;
  debounceMs: number;
  model: string;
  provider: 'agent-sdk' | 'api';
  /** Latency mode: when true, requests a fresh (non-warm) baseline call. */
  baseline: boolean;
}

/** The editor context for one completion request. */
export interface CompletionRequestContext {
  prefix: string;
  suffix: string;
  pos: number;
  mode: CompletionMode;
  inComment: boolean;
  midWord: boolean;
}

export interface SchedulerDeps {
  fetch: (req: CompletionInlineRequest, signal: AbortSignal) => Promise<CompletionResult>;
  getConfig: () => CompletionConfig;
  onSuggest: (text: string, ctx: CompletionRequestContext) => void;
  onClear: () => void;
  onResult?: (res: CompletionResult) => void;
  onError?: (err: unknown) => void;
}
