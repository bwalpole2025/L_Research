/**
 * ExecutionGate — the single admission control for server-side SANDBOX work
 * (LaTeX compile + Python run). It enforces, in one place:
 *
 *   - a GLOBAL concurrency cap across both paths and all users, so the
 *     resource-capped texlive/pyrun containers are never oversubscribed;
 *   - a PER-USER concurrency cap, so one user can't monopolise the pool;
 *   - a PER-USER DAILY quota of *runs* (the arbitrary-code / "miner" vector),
 *     so a single user can't launch unbounded server-side executions.
 *
 * Concurrency is enforced by WAITING (FIFO) — over the limit you queue, you are
 * never rejected. The daily quota is enforced by REJECTING fast (throwing
 * QuotaExceededError) so a quota-exhausted user never even occupies a slot.
 *
 * Keyed by principal id. Today every request is the single static-bearer
 * principal (userId null → one key); once real per-user auth lands the same gate
 * becomes genuinely per-user with no code change. See docs/isolation.md.
 */

export class QuotaExceededError extends Error {
  readonly statusCode = 429;
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export interface ExecutionGateOptions {
  /** Max concurrent executions across ALL users and both paths. */
  globalMax: number;
  /** Max concurrent executions for any single user. */
  perUserMax: number;
  /** Max server-side RUNS per user per UTC day (compiles don't count). */
  dailyRunsPerUser: number;
  /** Injectable clock (ms since epoch) for tests; defaults to Date.now. */
  now?: () => number;
}

export interface AcquireOptions {
  /** Count this acquisition against the user's daily RUN quota (runs: true). */
  countsAsRun?: boolean;
}

interface Waiter {
  userKey: string;
  resolve: () => void;
}

const MS_PER_DAY = 86_400_000;

export class ExecutionGate {
  private readonly globalMax: number;
  private readonly perUserMax: number;
  private readonly dailyRunsPerUser: number;
  private readonly now: () => number;

  private globalInflight = 0;
  private readonly userInflight = new Map<string, number>();
  private readonly waiters: Waiter[] = [];

  // Daily run counters, reset when the UTC day rolls over.
  private dayIndex: number;
  private readonly dailyRuns = new Map<string, number>();

  constructor(opts: ExecutionGateOptions) {
    this.globalMax = Math.max(1, opts.globalMax);
    this.perUserMax = Math.max(1, opts.perUserMax);
    this.dailyRunsPerUser = Math.max(1, opts.dailyRunsPerUser);
    this.now = opts.now ?? Date.now;
    this.dayIndex = Math.floor(this.now() / MS_PER_DAY);
  }

  /**
   * Acquire an execution slot. Resolves with a one-shot `release()` once a global
   * AND a per-user slot are free (waiting FIFO if not). Throws QuotaExceededError
   * immediately (before waiting) if `countsAsRun` and the user is out of daily
   * runs — so an exhausted user never holds a slot.
   */
  async acquire(userKey: string, opts: AcquireOptions = {}): Promise<() => void> {
    if (opts.countsAsRun) this.chargeDailyRun(userKey);

    if (this.hasFreeSlot(userKey)) {
      this.take(userKey);
    } else {
      // pump() takes the slot on our behalf (synchronously) before resolving, so
      // when we wake the counters already reflect us — no double counting, no race.
      await new Promise<void>((resolve) => this.waiters.push({ userKey, resolve }));
    }
    return this.makeRelease(userKey);
  }

  private take(userKey: string): void {
    this.globalInflight += 1;
    this.userInflight.set(userKey, (this.userInflight.get(userKey) ?? 0) + 1);
  }

  private makeRelease(userKey: string): () => void {
    let released = false;
    return () => {
      if (released) return; // idempotent — safe to call from multiple finallys
      released = true;
      this.globalInflight -= 1;
      const n = (this.userInflight.get(userKey) ?? 1) - 1;
      if (n <= 0) this.userInflight.delete(userKey);
      else this.userInflight.set(userKey, n);
      this.pump();
    };
  }

  /** Charge one daily run, rolling the day over first; throw if over quota. */
  private chargeDailyRun(userKey: string): void {
    this.rollDay();
    const used = this.dailyRuns.get(userKey) ?? 0;
    if (used >= this.dailyRunsPerUser) {
      const msToMidnight = (this.dayIndex + 1) * MS_PER_DAY - this.now();
      throw new QuotaExceededError(
        `Daily run quota reached (${this.dailyRunsPerUser}/day). Try again tomorrow, or run Python in your browser (client-side).`,
        Math.max(1, Math.ceil(msToMidnight / 1000)),
      );
    }
    this.dailyRuns.set(userKey, used + 1);
  }

  private rollDay(): void {
    const today = Math.floor(this.now() / MS_PER_DAY);
    if (today !== this.dayIndex) {
      this.dayIndex = today;
      this.dailyRuns.clear();
    }
  }

  private hasFreeSlot(userKey: string): boolean {
    return this.globalInflight < this.globalMax && (this.userInflight.get(userKey) ?? 0) < this.perUserMax;
  }

  /**
   * A slot just freed: wake the FIRST waiter whose user also has a per-user slot,
   * transferring the slot to it synchronously (take() before resolve) so a
   * concurrent acquire() can't slip past the cap in the microtask gap.
   */
  private pump(): void {
    for (let i = 0; i < this.waiters.length; i += 1) {
      if (this.globalInflight >= this.globalMax) return; // no global slot for anyone
      const w = this.waiters[i]!;
      if ((this.userInflight.get(w.userKey) ?? 0) < this.perUserMax) {
        this.waiters.splice(i, 1);
        this.take(w.userKey); // account the slot now; the woken acquire() won't re-take
        w.resolve();
        return; // one freed slot → one woken waiter
      }
    }
  }

  // ── Introspection (tests / metrics) ──────────────────────────────────────────
  globalInFlight(): number {
    return this.globalInflight;
  }
  userInFlight(userKey: string): number {
    return this.userInflight.get(userKey) ?? 0;
  }
  runsToday(userKey: string): number {
    this.rollDay();
    return this.dailyRuns.get(userKey) ?? 0;
  }
  waiting(): number {
    return this.waiters.length;
  }
}
