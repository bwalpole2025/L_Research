/**
 * Per-key serial queue with "latest wins" semantics:
 *  - at most ONE task runs per key at a time,
 *  - at most ONE task waits per key; submitting a new task while one is queued
 *    supersedes the queued one (which resolves with `supersededValue`).
 *
 * Used to coalesce rapid compile requests for the same project (e.g. compile on
 * save): the in-flight compile finishes, then only the most recent request runs.
 */
export class CompileQueue<T> {
  private readonly running = new Set<string>();
  private readonly pending = new Map<
    string,
    { task: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void; superseded: T }
  >();

  submit(key: string, task: () => Promise<T>, supersededValue: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const prev = this.pending.get(key);
      if (prev) prev.resolve(prev.superseded); // drop the older queued request
      this.pending.set(key, { task, resolve, reject, superseded: supersededValue });
      this.kick(key);
    });
  }

  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  hasPending(key: string): boolean {
    return this.pending.has(key);
  }

  private kick(key: string): void {
    if (this.running.has(key)) return;
    const next = this.pending.get(key);
    if (!next) return;

    this.pending.delete(key);
    this.running.add(key);
    next
      .task()
      .then(next.resolve, next.reject)
      .finally(() => {
        this.running.delete(key);
        this.kick(key);
      });
  }
}
