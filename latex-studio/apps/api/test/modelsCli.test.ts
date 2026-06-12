import { describe, expect, it, vi } from 'vitest';
import type { ChatRequest } from '@latex-studio/shared';
import { CliModelProvider } from '../src/providers/cli/cliProvider.js';
import { CODEX_CONFIG } from '../src/providers/cli/configs.js';
import { cliStatus } from '../src/providers/cli/detect.js';
import { resolveModelProvider, clearCliStatusCache } from '../src/providers/registry.js';
import type { CliRunResult, CliRunner } from '../src/providers/cli/spawnCli.js';

/** A stubbed CLI runner — lets us exercise the providers without the binaries. */
function fakeRunner(result: Partial<CliRunResult>): CliRunner {
  return vi.fn(async () => ({ code: 0, stdout: '', stderr: '', notFound: false, ...result }));
}

const chatReq: ChatRequest = { messages: [{ role: 'user', content: 'Say hi' }] };

describe('CliModelProvider (subprocess, no API key)', () => {
  it('passes the prompt on stdin and yields the parsed answer', async () => {
    const runner = fakeRunner({ stdout: 'Hello there.\n' });
    const provider = new CliModelProvider({ ...CODEX_CONFIG, parseOutput: (s) => s.trim() }, runner);

    let out = '';
    for await (const d of provider.chatStream(chatReq)) out += d.text;
    expect(out).toBe('Hello there.');

    const [command, , opts] = (runner as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(command).toBe('codex');
    expect(opts.input).toContain('Say hi'); // transcript fed on stdin
  });

  it('surfaces a typed "unavailable" error when the CLI is not installed', async () => {
    const provider = new CliModelProvider(CODEX_CONFIG, fakeRunner({ notFound: true, code: null }));
    await expect(async () => {
      for await (const _ of provider.chatStream(chatReq)) void _;
    }).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('surfaces a typed "auth" error when the CLI is not signed in', async () => {
    const provider = new CliModelProvider(CODEX_CONFIG, fakeRunner({ code: 1, stderr: 'Error: not logged in. Please sign in.' }));
    await expect(async () => {
      for await (const _ of provider.chatStream(chatReq)) void _;
    }).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('cliStatus', () => {
  it('reports not-installed on ENOENT', async () => {
    const runner = fakeRunner({ notFound: true, code: null });
    expect(await cliStatus('nope', runner)).toEqual({ installed: false });
  });
  it('parses a version when present', async () => {
    const runner = fakeRunner({ code: 0, stdout: 'codex 1.2.3\n' });
    expect(await cliStatus('codex', runner)).toEqual({ installed: true, version: '1.2.3' });
  });
});

describe('resolveModelProvider', () => {
  it('uses the Anthropic singleton by default', async () => {
    clearCliStatusCache();
    const sentinel = { id: 'anthropic-singleton' };
    const app = { modelProvider: sentinel } as never;
    const r = await resolveModelProvider(app, { model: 'claude-sonnet-4-6', aiProvider: 'anthropic' });
    expect(r.providerId).toBe('anthropic');
    expect(r.provider).toBe(sentinel);
    expect(r.model).toBe('claude-sonnet-4-6');
  });

  it('falls back to Claude (no crash) when the selected CLI is not installed', async () => {
    clearCliStatusCache();
    const sentinel = { id: 'anthropic-singleton' };
    const app = { modelProvider: sentinel } as never;
    // `gemini` is not installed in this environment → graceful fallback + reason.
    const r = await resolveModelProvider(app, { model: 'claude-sonnet-4-6', aiProvider: 'gemini' });
    expect(r.providerId).toBe('anthropic');
    expect(r.provider).toBe(sentinel);
    expect(r.fallbackReason).toMatch(/not installed/i);
  });
});
