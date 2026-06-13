import { describe, expect, it } from 'vitest';
import { CompileQueue } from '../src/compile/queue.js';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('CompileQueue', () => {
  it('runs a single task to completion', async () => {
    const q = new CompileQueue<number>();
    await expect(q.submit('p', async () => 1, -1)).resolves.toBe(1);
  });

  it('runs one at a time and supersedes the queued task', async () => {
    const q = new CompileQueue<string>();
    const gateA = deferred();

    const order: string[] = [];
    const pA = q.submit(
      'p',
      async () => {
        await gateA.promise;
        order.push('A');
        return 'A';
      },
      'superseded',
    );
    expect(q.isRunning('p')).toBe(true);

    // B queues behind A; C then supersedes B.
    const pB = q.submit('p', async () => 'B', 'superseded');
    const pC = q.submit('p', async () => {
      order.push('C');
      return 'C';
    }, 'superseded');

    await expect(pB).resolves.toBe('superseded');

    gateA.resolve();
    await expect(pA).resolves.toBe('A');
    await expect(pC).resolves.toBe('C');
    expect(order).toEqual(['A', 'C']); // B never ran
  });

  it('keeps separate lanes per key', async () => {
    const q = new CompileQueue<string>();
    const [a, b] = await Promise.all([
      q.submit('p1', async () => 'p1', 'x'),
      q.submit('p2', async () => 'p2', 'x'),
    ]);
    expect([a, b]).toEqual(['p1', 'p2']);
  });

  it('caps concurrent tasks across keys at maxConcurrent', async () => {
    const q = new CompileQueue<string>(2);
    const gate = deferred();
    let peak = 0;

    // 5 distinct projects submitted at once; without a cap all 5 would run.
    const tasks = ['a', 'b', 'c', 'd', 'e'].map((k) =>
      q.submit(
        k,
        async () => {
          peak = Math.max(peak, q.runningCount());
          await gate.promise;
          return k;
        },
        'x',
      ),
    );

    // Let the microtask queue drain so pump() has started all it can.
    await Promise.resolve();
    expect(q.runningCount()).toBe(2); // only 2 in flight despite 5 pending

    gate.resolve();
    await expect(Promise.all(tasks)).resolves.toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(peak).toBe(2); // never exceeded the cap
  });

  it('clamps maxConcurrent to at least 1', async () => {
    const q = new CompileQueue<string>(0);
    const gate = deferred();
    const p1 = q.submit('p1', async () => {
      await gate.promise;
      return 'p1';
    }, 'x');
    const p2 = q.submit('p2', async () => 'p2', 'x');

    await Promise.resolve();
    expect(q.runningCount()).toBe(1); // 0 clamped up to 1

    gate.resolve();
    await expect(Promise.all([p1, p2])).resolves.toEqual(['p1', 'p2']);
  });

  it('serializes per key even when the global cap has spare slots', async () => {
    const q = new CompileQueue<string>(4);
    const gateA = deferred();
    const order: string[] = [];

    const a1 = q.submit('p', async () => {
      await gateA.promise;
      order.push('a1');
      return 'a1';
    }, 'x');
    // Same key — must wait for a1 even though 3 global slots are free.
    const a2 = q.submit('p', async () => {
      order.push('a2');
      return 'a2';
    }, 'x');

    await Promise.resolve();
    expect(q.runningCount()).toBe(1); // p is busy; a2 cannot start in parallel

    gateA.resolve();
    await expect(Promise.all([a1, a2])).resolves.toEqual(['a1', 'a2']);
    expect(order).toEqual(['a1', 'a2']);
  });
});
