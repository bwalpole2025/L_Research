import { describe, it, expect } from 'vitest';
import { buildLockedOptions, DISALLOWED_TOOLS } from '../src/providers/lockedOptions.js';
import { parseReplacement } from '../src/providers/prompts.js';
import { classifyAiError, AiProviderError } from '../src/providers/errors.js';
import { assertSubscriptionAuth } from '../src/providers/guard.js';
import { isAcceptableModel, createModelProvider, ApiKeyProvider } from '../src/providers/index.js';
import { loadConfig } from '../src/config.js';
import { buildApp } from '../src/app.js';

describe('buildLockedOptions — pure text generation, no tools', () => {
  const o = buildLockedOptions({ model: 'claude-sonnet-4-6', systemPrompt: 'x' });

  it('grants zero tools and forbids the dangerous ones', () => {
    expect(o.tools).toEqual([]);
    expect(o.disallowedTools).toEqual(
      expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit', 'WebSearch', 'WebFetch', 'Glob', 'Grep']),
    );
    expect(DISALLOWED_TOOLS).toContain('Bash');
  });

  it('disables MCP, on-disk settings/skills, and is single-turn', () => {
    expect(o.mcpServers).toEqual({});
    expect(o.strictMcpConfig).toBe(true);
    expect(o.settingSources).toEqual([]);
    expect(o.skills).toEqual([]);
    expect(o.maxTurns).toBe(1);
  });

  it('strips the subscription-overriding env keys passed to the subprocess', () => {
    expect(o.env?.['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(o.env?.['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
  });
});

describe('parseReplacement', () => {
  it('extracts from <replacement> tags, stripping stray prose', () => {
    expect(parseReplacement('Sure! <replacement>\\end{align}</replacement> hope that helps')).toBe('\\end{align}');
  });
  it('strips a markdown fence when there are no tags', () => {
    expect(parseReplacement('Here you go:\n```latex\n\\alpha + \\beta\n```\nDone')).toBe('\\alpha + \\beta');
  });
  it('strips a fence nested inside tags', () => {
    expect(parseReplacement('<replacement>```\nA\nB\n```</replacement>')).toBe('A\nB');
  });
  it('falls back to trimmed text', () => {
    expect(parseReplacement('   x = 1   ')).toBe('x = 1');
  });
});

describe('classifyAiError', () => {
  it('classifies auth, credit, unavailable, and other', () => {
    expect(classifyAiError(new Error('Please run claude login to authenticate'))).toBe('auth');
    expect(classifyAiError(new Error('You have reached your usage limit for this plan'))).toBe('credit_exhausted');
    expect(classifyAiError(new Error('spawn claude ENOENT'))).toBe('unavailable');
    expect(classifyAiError(new Error('something odd happened'))).toBe('other');
    expect(classifyAiError(new AiProviderError('credit_exhausted', 'x'))).toBe('credit_exhausted');
  });
});

describe('isAcceptableModel', () => {
  it('accepts known aliases/ids, live entries, and claude-* ; rejects others', () => {
    expect(isAcceptableModel('claude-sonnet-4-6')).toBe(true);
    expect(isAcceptableModel('sonnet')).toBe(true);
    expect(isAcceptableModel('claude-future-9')).toBe(true);
    expect(isAcceptableModel('custom-x', ['custom-x'])).toBe(true);
    expect(isAcceptableModel('gpt-4o')).toBe(false);
    expect(isAcceptableModel('')).toBe(false);
  });
});

describe('subscription boot guard', () => {
  const base = loadConfig();

  it('throws when ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set under agent-sdk', () => {
    const cfg = { ...base, modelProvider: 'agent-sdk' as const };
    expect(() => assertSubscriptionAuth(cfg, { ANTHROPIC_API_KEY: 'sk-ant-x' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => assertSubscriptionAuth(cfg, { ANTHROPIC_AUTH_TOKEN: 'tok' })).toThrow(/ANTHROPIC_AUTH_TOKEN/);
    expect(() => assertSubscriptionAuth(cfg, {})).not.toThrow();
  });

  it('allows API keys under the api provider', () => {
    const cfg = { ...base, modelProvider: 'api' as const };
    expect(() => assertSubscriptionAuth(cfg, { ANTHROPIC_API_KEY: 'sk' })).not.toThrow();
  });

  it('buildApp refuses to boot with ANTHROPIC_API_KEY in the environment', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    try {
      await expect(buildApp({ logger: false })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});

describe('ApiKeyProvider stub', () => {
  it('throws "not configured" from every method', async () => {
    const p = new ApiKeyProvider();
    await expect(p.complete()).rejects.toThrow(/not configured/);
    await expect(p.editRegion()).rejects.toThrow(/not configured/);
    const iterator = p.chatStream({ messages: [] })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(/not configured/);
  });

  it('createModelProvider selects the provider by config', () => {
    expect(createModelProvider({ ...loadConfig(), modelProvider: 'api' })).toBeInstanceOf(ApiKeyProvider);
  });
});
