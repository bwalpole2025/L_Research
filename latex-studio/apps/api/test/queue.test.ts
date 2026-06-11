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
});
