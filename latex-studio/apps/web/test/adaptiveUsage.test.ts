import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bumpUsageScore, decayedUsageScore, USAGE_HALFLIFE_DAYS } from '@latex-studio/shared';
import {
  __injectUsageForTests,
  __resetUsageForTests,
  __setProjectForTests,
  recordAccept,
  topUsage,
  usageBoost,
  usageScope,
  useAdaptiveStore,
  USAGE_BOOST_CAP,
} from '../lib/usage';

vi.mock('../lib/api', () => ({
  api: {
    getUsage: vi.fn(async () => ({ app: [], project: [] })),
    postUsage: vi.fn(async () => undefined),
    deleteUsage: vi.fn(async () => undefined),
  },
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-06-12T12:00:00Z');

beforeEach(() => {
  __resetUsageForTests();
  __setProjectForTests('proj-A');
  useAdaptiveStore.setState({ adaptive: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usage scoring — frequency + recency with a 30-day half-life', () => {
  it('one accept decays to half after exactly one half-life', () => {
    const at = new Date(NOW).toISOString();
    expect(decayedUsageScore(1, at, NOW)).toBeCloseTo(1);
    expect(decayedUsageScore(1, at, NOW + USAGE_HALFLIFE_DAYS * DAY)).toBeCloseTo(0.5);
    expect(decayedUsageScore(1, at, NOW + 2 * USAGE_HALFLIFE_DAYS * DAY)).toBeCloseTo(0.25);
  });

  it('bump folds the decayed history into a running sum', () => {
    // Two accepts 30 days apart: at the second, the first is worth 0.5.
    const first = bumpUsageScore(0, new Date(NOW).toISOString(), NOW);
    const second = bumpUsageScore(first.score, first.lastUsedAt, NOW + USAGE_HALFLIFE_DAYS * DAY);
    expect(second.score).toBeCloseTo(1.5);
  });

  it('RECENCY: heavy use long ago ranks below heavy use this week', () => {
    // 8 accepts, 90 days ago → decayed to 8 · 0.5³ = 1. 3 accepts this week → ≈ 3.
    __injectUsageForTests('cmd', 'stale', { count: 8, score: 8, firstUsedAt: '', lastUsedAt: new Date(NOW - 90 * DAY).toISOString() });
    __injectUsageForTests('cmd', 'fresh', { count: 3, score: 3, firstUsedAt: '', lastUsedAt: new Date(NOW - 2 * DAY).toISOString() });
    expect(usageBoost('cmd', 'fresh', NOW)).toBeGreaterThan(usageBoost('cmd', 'stale', NOW));
  });

  it('fully-faded habits stop influencing the order entirely', () => {
    __injectUsageForTests('cmd', 'ancient', { count: 2, score: 2, firstUsedAt: '', lastUsedAt: new Date(NOW - 300 * DAY).toISOString() });
    expect(usageBoost('cmd', 'ancient', NOW)).toBe(0);
  });
});

describe('usage boost — bounded, tiered, category-scoped', () => {
  it('COLD START: no history → boost 0 (the static order stands)', () => {
    expect(usageBoost('cmd', 'frac', NOW)).toBe(0);
    expect(topUsage('app')).toEqual([]);
  });

  it('is capped below the smallest source-tier gap (10), so usage reorders WITHIN a tier but never across', () => {
    __injectUsageForTests('cmd', 'frac', { count: 500, score: 500, firstUsedAt: '', lastUsedAt: new Date(NOW).toISOString() });
    expect(usageBoost('cmd', 'frac', NOW)).toBe(USAGE_BOOST_CAP);
    expect(USAGE_BOOST_CAP).toBeLessThan(10);
  });

  it('is monotonic in the decayed score', () => {
    __injectUsageForTests('cmd', 'one', { count: 1, score: 1, firstUsedAt: '', lastUsedAt: new Date(NOW).toISOString() });
    __injectUsageForTests('cmd', 'ten', { count: 10, score: 10, firstUsedAt: '', lastUsedAt: new Date(NOW).toISOString() });
    const one = usageBoost('cmd', 'one', NOW);
    const ten = usageBoost('cmd', 'ten', NOW);
    expect(one).toBeGreaterThanOrEqual(1);
    expect(ten).toBeGreaterThan(one);
  });

  it('CATEGORY ISOLATION: cite usage never bleeds into command ranking (and vice versa)', () => {
    recordAccept('cite', 'frac', NOW); // a (weird) bib key named frac
    expect(usageBoost('cite', 'frac', NOW)).toBeGreaterThan(0);
    expect(usageBoost('cmd', 'frac', NOW)).toBe(0);
  });

  it('toggling adaptive OFF restores the non-adaptive order (boost 0 everywhere)', () => {
    recordAccept('cmd', 'frac', NOW);
    expect(usageBoost('cmd', 'frac', NOW)).toBeGreaterThan(0);
    useAdaptiveStore.setState({ adaptive: false });
    expect(usageBoost('cmd', 'frac', NOW)).toBe(0);
    useAdaptiveStore.setState({ adaptive: true });
    expect(usageBoost('cmd', 'frac', NOW)).toBeGreaterThan(0);
  });
});

describe('scoping — app habits carry across projects, project keys do not', () => {
  it('declares the right scope per category', () => {
    expect(usageScope('cmd')).toBe('app');
    expect(usageScope('env')).toBe('app');
    expect(usageScope('snippet')).toBe('app');
    expect(usageScope('cite')).toBe('project');
    expect(usageScope('label')).toBe('project');
    expect(usageScope('gfx')).toBe('project');
  });

  it('command habits survive a project switch; cite-key habits are dropped', () => {
    recordAccept('cmd', 'frac', NOW);
    recordAccept('cite', 'basset1888', NOW);
    expect(usageBoost('cmd', 'frac', NOW)).toBeGreaterThan(0);
    expect(usageBoost('cite', 'basset1888', NOW)).toBeGreaterThan(0);

    __setProjectForTests('proj-B'); // switch project → project map reset
    expect(usageBoost('cmd', 'frac', NOW)).toBeGreaterThan(0); // typing habit carried
    expect(usageBoost('cite', 'basset1888', NOW)).toBe(0); // bib key did NOT leak
  });
});

describe('server reconcile — debounced and batched, never per keystroke', () => {
  it('accepts are batched into ONE POST after the debounce window', async () => {
    vi.useFakeTimers();
    const { api } = await import('../lib/api');
    recordAccept('cmd', 'frac');
    recordAccept('cmd', 'frac');
    recordAccept('env', 'align');
    expect(api.postUsage).not.toHaveBeenCalled(); // nothing in-band
    await vi.advanceTimersByTimeAsync(1600);
    expect(api.postUsage).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(api.postUsage).mock.calls[0]!;
    expect(body.events).toHaveLength(3);
    expect(body.events.filter((e) => e.key === 'cmd:frac')).toHaveLength(2);
    expect(body.events.every((e) => ['app', 'project'].includes(e.scope))).toBe(true);
  });
});
