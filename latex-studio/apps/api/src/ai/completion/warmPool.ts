import type { Options } from '@anthropic-ai/claude-agent-sdk';

/** A pre-warmed, single-use query handle (see ADR-006). */
type WarmQuery = Awaited<ReturnType<typeof import('@anthropic-ai/claude-agent-sdk')['startup']>>;

interface PoolEntry {
  /** A pre-warmed (or in-flight warming) handle, ready to consume once. */
  ready: Promise<WarmQuery> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Keeps one pre-warmed `WarmQuery` per project so completions reuse an already
 * spawned+initialized subprocess. Each `WarmQuery` is single-use, so we consume
 * it and replenish in the background (off the request's critical path). Pools
 * are idle-killed after `idleMs`.
 */
export class WarmPool {
  private readonly pools = new Map<string, PoolEntry>();

  constructor(
    private readonly optionsFor: () => Options,
    private readonly idleMs: number,
  ) {}

  private async startup(): Promise<WarmQuery> {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    return mod.startup({ options: this.optionsFor() });
  }

  /** Take a warm handle for `projectId` (or spin a cold one), then replenish. */
  async acquire(projectId: string): Promise<{ warm: WarmQuery; variant: 'warm' | 'cold' }> {
    let entry = this.pools.get(projectId);
    if (!entry) {
      entry = { ready: null, idleTimer: null };
      this.pools.set(projectId, entry);
    }

    let warm: WarmQuery | null = null;
    let variant: 'warm' | 'cold' = 'cold';
    if (entry.ready) {
      try {
        warm = await entry.ready;
        variant = 'warm';
      } catch {
        warm = null;
      }
      entry.ready = null;
    }
    if (!warm) {
      warm = await this.startup();
      variant = 'cold';
    }

    this.touch(projectId);
    this.replenish(projectId);
    return { warm, variant };
  }

  private replenish(projectId: string): void {
    const entry = this.pools.get(projectId);
    if (!entry || entry.ready) return;
    const p = this.startup();
    entry.ready = p;
    // If pre-warming fails, drop it so the next acquire goes cold.
    p.catch(() => {
      const e = this.pools.get(projectId);
      if (e && e.ready === p) e.ready = null;
    });
  }

  private touch(projectId: string): void {
    const entry = this.pools.get(projectId);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.evict(projectId), this.idleMs);
    entry.idleTimer.unref();
  }

  /** Close and forget a project's pool (idle-kill or shutdown). */
  evict(projectId: string): void {
    const entry = this.pools.get(projectId);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const ready = entry.ready;
    this.pools.delete(projectId);
    if (ready) {
      ready
        .then((w) => {
          try {
            w.close();
          } catch {
            /* already gone */
          }
        })
        .catch(() => undefined);
    }
  }

  shutdown(): void {
    for (const id of [...this.pools.keys()]) this.evict(id);
  }
}
