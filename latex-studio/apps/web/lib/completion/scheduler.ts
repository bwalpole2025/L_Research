import { LruCache } from './cache';
import { cacheKey, shouldTrigger } from './suggestion';
import type { CompletionConfig, CompletionRequestContext, SchedulerDeps } from './types';

/**
 * The client completion scheduler: debounce, ≤1 request in flight (debounce
 * coalesces rapid typing; a new run aborts any superseded one), an LRU cache
 * (speculative reuse on identical context), and the no-trigger rules. Framework-
 * agnostic and dependency-injected so it's unit-testable.
 */
export class CompletionScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private readonly cache = new LruCache<string>(100);
  private lastRejectionPos: number | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  /** Called on each (debounced) typing event. */
  schedule(ctx: CompletionRequestContext): void {
    this.clearTimer();
    const cfg = this.deps.getConfig();
    if (!shouldTrigger(ctx, cfg, this.lastRejectionPos)) {
      this.deps.onClear();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(ctx, cfg, false);
    }, cfg.debounceMs);
  }

  /** Alt+] — request a fresh alternative (bypass the cache). */
  alternative(ctx: CompletionRequestContext): void {
    this.clearTimer();
    const cfg = this.deps.getConfig();
    if (!cfg.enabled || !cfg.perMode[ctx.mode]) return;
    void this.run(ctx, cfg, true);
  }

  private async run(ctx: CompletionRequestContext, cfg: CompletionConfig, bypassCache: boolean): Promise<void> {
    const key = cacheKey(ctx.prefix, ctx.suffix);
    if (!bypassCache && this.cache.has(key)) {
      const cached = this.cache.get(key) ?? '';
      if (cached) this.deps.onSuggest(cached, ctx);
      else this.deps.onClear();
      return;
    }

    this.inflight?.abort(); // supersede — keeps ≤1 in flight
    const ac = new AbortController();
    this.inflight = ac;
    try {
      const res = await this.deps.fetch(
        {
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          mode: ctx.mode,
          model: cfg.model,
          provider: cfg.provider,
          baseline: cfg.baseline,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      this.cache.set(key, res.completion);
      this.deps.onResult?.(res);
      if (res.completion) this.deps.onSuggest(res.completion, ctx);
      else this.deps.onClear();
    } catch (err) {
      if (ac.signal.aborted || (err as { name?: string })?.name === 'AbortError') return;
      this.deps.onError?.(err);
    } finally {
      if (this.inflight === ac) this.inflight = null;
    }
  }

  recordRejection(pos: number): void {
    this.lastRejectionPos = pos;
  }

  clearRejection(): void {
    this.lastRejectionPos = null;
  }

  /** Cancel pending + in-flight work (e.g. when completions are toggled off). */
  abort(): void {
    this.clearTimer();
    this.inflight?.abort();
    this.inflight = null;
  }

  hasInflight(): boolean {
    return this.inflight !== null;
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
