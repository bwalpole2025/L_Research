import { describe, expect, it } from 'vitest';
import { ExecutionGate, QuotaExceededError } from '../src/exec/gate.js';

/** Resolve after pending microtasks settle, so woken waiters have run. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('ExecutionGate — per-user concurrency cap', () => {
  it('holds a user to perUserMax even when global slots are free', async () => {
    const gate = new ExecutionGate({ globalMax: 10, perUserMax: 2, dailyRunsPerUser: 1000 });

    const r1 = await gate.acquire('alice');
    const r2 = await gate.acquire('alice');
    expect(gate.userInFlight('alice')).toBe(2);

    // Third concurrent acquire for alice must WAIT despite 8 free global slots.
    let third = false;
    const p3 = gate.acquire('alice').then((rel) => {
      third = true;
      return rel;
    });
    await tick();
    expect(third).toBe(false);
    expect(gate.userInFlight('alice')).toBe(2);
    expect(gate.waiting()).toBe(1);

    // Releasing one lets the waiter through (still capped at 2).
    r1();
    const r3 = await p3;
    expect(third).toBe(true);
    expect(gate.userInFlight('alice')).toBe(2);

    r2();
    r3();
    expect(gate.userInFlight('alice')).toBe(0);
  });

  it('one user at their cap does not block a different user', async () => {
    const gate = new ExecutionGate({ globalMax: 10, perUserMax: 1, dailyRunsPerUser: 1000 });
    const a1 = await gate.acquire('alice');

    let bobRan = false;
    const pBob = gate.acquire('bob').then((rel) => {
      bobRan = true;
      return rel;
    });
    await tick();
    expect(bobRan).toBe(true); // bob has his own per-user budget
    (await pBob)();
    a1();
  });
});

describe('ExecutionGate — global concurrency cap', () => {
  it('never exceeds globalMax across users; queues the rest', async () => {
    const gate = new ExecutionGate({ globalMax: 2, perUserMax: 5, dailyRunsPerUser: 1000 });
    const a = await gate.acquire('alice');
    const b = await gate.acquire('bob');
    expect(gate.globalInFlight()).toBe(2);

    let carolRan = false;
    const pCarol = gate.acquire('carol').then((rel) => {
      carolRan = true;
      return rel;
    });
    await tick();
    expect(carolRan).toBe(false); // global cap reached
    expect(gate.globalInFlight()).toBe(2);

    a(); // frees a global slot → carol proceeds
    const c = await pCarol;
    expect(carolRan).toBe(true);
    expect(gate.globalInFlight()).toBe(2);
    b();
    c();
    expect(gate.globalInFlight()).toBe(0);
  });
});

describe('ExecutionGate — per-user daily run quota', () => {
  it('rejects runs past the daily quota, without occupying a slot', async () => {
    const gate = new ExecutionGate({ globalMax: 10, perUserMax: 10, dailyRunsPerUser: 3 });

    // Three runs allowed; release each so concurrency is never the limiter.
    for (let i = 0; i < 3; i += 1) (await gate.acquire('alice', { countsAsRun: true }))();
    expect(gate.runsToday('alice')).toBe(3);

    await expect(gate.acquire('alice', { countsAsRun: true })).rejects.toBeInstanceOf(QuotaExceededError);
    expect(gate.globalInFlight()).toBe(0); // the rejected run took no slot

    // A different user is unaffected.
    (await gate.acquire('bob', { countsAsRun: true }))();
    expect(gate.runsToday('bob')).toBe(1);
  });

  it('compiles (countsAsRun omitted) do NOT consume the daily run quota', async () => {
    const gate = new ExecutionGate({ globalMax: 10, perUserMax: 10, dailyRunsPerUser: 1 });
    // Many compiles, none counted as runs.
    for (let i = 0; i < 5; i += 1) (await gate.acquire('alice'))();
    expect(gate.runsToday('alice')).toBe(0);
    // The single daily RUN is still available.
    (await gate.acquire('alice', { countsAsRun: true }))();
    expect(gate.runsToday('alice')).toBe(1);
    await expect(gate.acquire('alice', { countsAsRun: true })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('resets the daily quota at the UTC day boundary', async () => {
    let nowMs = 1_000 * 86_400_000 + 5_000; // mid-day on some UTC day
    const gate = new ExecutionGate({ globalMax: 10, perUserMax: 10, dailyRunsPerUser: 1, now: () => nowMs });
    (await gate.acquire('alice', { countsAsRun: true }))();
    await expect(gate.acquire('alice', { countsAsRun: true })).rejects.toBeInstanceOf(QuotaExceededError);

    nowMs += 86_400_000; // next day
    (await gate.acquire('alice', { countsAsRun: true }))(); // quota refreshed
    expect(gate.runsToday('alice')).toBe(1);
  });
});
