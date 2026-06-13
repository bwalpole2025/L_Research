/**
 * Per-key serial queue with "latest wins" semantics AND a global concurrency
 * cap:
 *  - at most ONE task runs per key at a time (the per-project throttle),
 *  - at most ONE task waits per key; submitting a new task while one is queued
 *    supersedes the queued one (which resolves with `supersededValue`),
 *  - at most `maxConcurrent` tasks run across ALL keys at once, so many
 *    projects/tabs can't overwhelm the resource-capped texlive container —
 *    excess submissions wait in the pending map and start as slots free.
 *
 * Used to coalesce rapid compile requests for the same project (e.g. compile on
 * save): the in-flight compile finishes, then only the most recent request runs.
 */
export class CompileQueue<T> {
  private readonly running = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly pending = new Map<
    string,
    { task: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void; superseded: T }
  >();

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
  }

  submit(key: string, task: () => Promise<T>, supersededValue: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const prev = this.pending.get(key);
      if (prev) prev.resolve(prev.superseded); // drop the older queued request
      this.pending.set(key, { task, resolve, reject, superseded: supersededValue });
      this.pump();
    });
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  hasPending(key: string): boolean {
    return this.pending.has(key);
  }

  /** Tasks currently executing across all keys (for tests/metrics). */
  runningCount(): number {
    return this.running.size;
  }

  /** Start as many pending tasks as the global cap allows — one per key (a key
   *  already running is skipped, preserving per-project serialization). */
  private pump(): void {
    for (const key of [...this.pending.keys()]) {
      if (this.running.size >= this.maxConcurrent) break;
      if (this.running.has(key)) continue;
      const next = this.pending.get(key);
      if (!next) continue;
      this.pending.delete(key);
      this.running.add(key);
      next
        .task()
        .then(next.resolve, next.reject)
        .finally(() => {
          this.running.delete(key);
          this.pump();
        });
    }
  }
}
