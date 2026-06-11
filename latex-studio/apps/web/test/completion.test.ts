import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionScheduler } from '../lib/completion/scheduler';
import { detectMode } from '../lib/completion/mode';
import { LruCache } from '../lib/completion/cache';
import { advanceSuggestion, cacheKey, shouldTrigger } from '../lib/completion/suggestion';
import { formatCounterexample, mathContent, rhsOf } from '../lib/completion/mathStep';
import type { CompletionConfig, CompletionRequestContext } from '../lib/completion/types';
import type { CompletionResult } from '../lib/types';

function cfg(over?: Partial<CompletionConfig>): CompletionConfig {
  return {
    enabled: true,
    perMode: { prose: true, 'inline-math': true, 'display-align': true, preamble: true },
    debounceMs: 400,
    model: 'claude-haiku-4-5',
    provider: 'agent-sdk',
    baseline: false,
    ...over,
  };
}

function ctx(pos: number, over?: Partial<CompletionRequestContext>): CompletionRequestContext {
  return { prefix: `hello ${pos}`, suffix: '', pos, mode: 'prose', inComment: false, midWord: false, ...over };
}

const result = (completion: string): CompletionResult => ({
  completion,
  latencyMs: 1,
  variant: 'warm',
  provider: 'agent-sdk',
  model: 'claude-haiku-4-5',
});

afterEach(() => vi.useRealTimers());

describe('detectMode', () => {
  const PRE = '\\documentclass{article}\n';
  const doc = `${PRE}\\usepackage{amsmath}\n\\begin{document}\nProse here $a+b$ and\n\\begin{align}\nx &= 1\n\\end{align}\n% a comment line\n\\end{document}\n`;

  it('detects preamble before \\begin{document}', () => {
    expect(detectMode(doc, 10).mode).toBe('preamble');
  });
  it('detects prose in the body', () => {
    const pos = doc.indexOf('Prose here') + 3;
    expect(detectMode(doc, pos).mode).toBe('prose');
  });
  it('detects inline math inside $…$', () => {
    const pos = doc.indexOf('a+b') + 1;
    expect(detectMode(doc, pos).mode).toBe('inline-math');
  });
  it('detects display-align inside an align block', () => {
    const pos = doc.indexOf('x &= 1') + 2;
    expect(detectMode(doc, pos).mode).toBe('display-align');
  });
  it('flags comments and mid-word', () => {
    const cpos = doc.indexOf('a comment') + 2;
    expect(detectMode(doc, cpos).inComment).toBe(true);
    const word = 'foobar';
    expect(detectMode(word, 3).midWord).toBe(true);
    expect(detectMode(word, 6).midWord).toBe(false);
  });
});

describe('LruCache', () => {
  it('evicts the least-recently-used', () => {
    const c = new LruCache<string>(2);
    c.set('a', '1');
    c.set('b', '2');
    c.get('a'); // a becomes recent
    c.set('c', '3'); // evicts b
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
  });
});

describe('suggestion helpers', () => {
  it('advanceSuggestion trims a matching typed prefix (speculative reuse)', () => {
    expect(advanceSuggestion('world', 'wor')).toBe('ld');
    expect(advanceSuggestion('world', 'world')).toBeNull();
    expect(advanceSuggestion('world', 'x')).toBeNull();
  });
  it('cacheKey depends only on the prefix tail + suffix head', () => {
    const tail = 'z'.repeat(250);
    const suffix = 'suffixhead';
    // Same last-200 of prefix + same suffix ⇒ same key (leading prefix ignored).
    expect(cacheKey(`AAAA${tail}`, suffix)).toBe(cacheKey(`BBBB${tail}`, suffix));
    // A different tail ⇒ different key.
    expect(cacheKey(`AAAA${tail}`, suffix)).not.toBe(cacheKey(`different${'z'.repeat(100)}`, suffix));
  });
  it('shouldTrigger respects enabled, per-mode, comment-mid-word, and post-reject', () => {
    expect(shouldTrigger(ctx(1), cfg(), null)).toBe(true);
    expect(shouldTrigger(ctx(1), cfg({ enabled: false }), null)).toBe(false);
    expect(shouldTrigger(ctx(1, { mode: 'prose' }), cfg({ perMode: { prose: false, 'inline-math': true, 'display-align': true, preamble: true } }), null)).toBe(false);
    expect(shouldTrigger(ctx(1, { inComment: true, midWord: true }), cfg(), null)).toBe(false);
    expect(shouldTrigger(ctx(7), cfg(), 7)).toBe(false);
  });
});

describe('math step helpers (verification hook)', () => {
  it('extracts the RHS of an align row, ignoring &, \\\\, labels', () => {
    expect(rhsOf('x &= 2(y+1) \\\\')).toBe('2(y+1)');
    expect(rhsOf('  y &= 2y + 2 \\label{eq:a}')).toBe('2y + 2');
    expect(rhsOf('\\begin{align}')).toBeNull();
    expect(rhsOf('just prose')).toBeNull();
  });
  it('mathContent strips environment lines', () => {
    expect(mathContent('\\end{align}')).toBeNull();
    expect(mathContent('a &= b')).toBe('a = b');
  });
  it('formats a counterexample', () => {
    expect(formatCounterexample({ values: { x: 1 }, lhsVal: 2, rhsVal: 4 })).toBe('x=1: 2 ≠ 4');
  });
});

describe('CompletionScheduler', () => {
  it('coalesces rapid typing into a single request (≤1 in flight)', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => result('world'));
    const sched = new CompletionScheduler({ fetch, getConfig: () => cfg(), onSuggest: () => {}, onClear: () => {} });
    for (let i = 0; i < 25; i++) sched.schedule(ctx(i)); // rapid typing
    expect(fetch).not.toHaveBeenCalled(); // still debouncing
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts a superseded in-flight request (never >1 concurrent)', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_req: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<CompletionResult>(() => {}); // never resolves
    });
    const sched = new CompletionScheduler({ fetch, getConfig: () => cfg(), onSuggest: () => {}, onClear: () => {} });
    sched.schedule(ctx(1));
    await vi.advanceTimersByTimeAsync(400);
    sched.schedule(ctx(2));
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });

  it('toggling completions off stops all network calls', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => result('w'));
    let config = cfg();
    const sched = new CompletionScheduler({ fetch, getConfig: () => config, onSuggest: () => {}, onClear: () => {} });
    sched.schedule(ctx(1));
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    config = cfg({ enabled: false });
    sched.schedule(ctx(2));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1); // no further calls
  });

  it('serves an identical context from cache without a call (speculative reuse)', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => result('world'));
    const suggested: string[] = [];
    const sched = new CompletionScheduler({ fetch, getConfig: () => cfg(), onSuggest: (t) => suggested.push(t), onClear: () => {} });
    const c = ctx(5);
    sched.schedule(c);
    await vi.advanceTimersByTimeAsync(400);
    sched.schedule(c); // identical context
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(suggested).toEqual(['world', 'world']);
  });

  it('does not call mid-word in a comment, or right after a rejection at the same pos', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => result('w'));
    const sched = new CompletionScheduler({ fetch, getConfig: () => cfg(), onSuggest: () => {}, onClear: () => {} });
    sched.schedule(ctx(3, { inComment: true, midWord: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).not.toHaveBeenCalled();

    sched.recordRejection(7);
    sched.schedule(ctx(7));
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).not.toHaveBeenCalled();

    sched.clearRejection();
    sched.schedule(ctx(7));
    await vi.advanceTimersByTimeAsync(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
