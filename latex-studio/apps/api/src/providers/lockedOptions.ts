import { tmpdir } from 'node:os';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

/**
 * Tools we explicitly forbid. `tools: []` already grants none, but listing them
 * in `disallowedTools` is belt-and-suspenders and documents intent.
 */
export const DISALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'WebSearch',
  'WebFetch',
  'Glob',
  'Grep',
  'Agent',
  'Monitor',
  'AskUserQuestion',
];

export interface LockedOptionsInput {
  model: string;
  systemPrompt: string;
  abortController?: AbortController;
  includePartialMessages?: boolean;
  cwd?: string;
  /** When false, the session is never written to disk (stateless completions). */
  persistSession?: boolean;
}

/**
 * Subprocess environment with the two subscription-overriding keys stripped.
 * Defense-in-depth: the boot guard already refuses to start when these are set,
 * but we also never pass them to the SDK subprocess.
 */
export function sanitizedEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  return { ...env, ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined };
}

/**
 * Build the Agent SDK options that lock it to PURE TEXT GENERATION: no tools,
 * no filesystem/bash, no MCP, no on-disk settings/skills, single-turn. This app
 * embeds the model as a writing engine, not an autonomous agent.
 *
 * Asserted by providers.test.ts.
 */
export function buildLockedOptions(input: LockedOptionsInput): Options {
  const options: Options = {
    model: input.model,
    systemPrompt: input.systemPrompt,
    tools: [], // no built-in tools at all
    allowedTools: [],
    disallowedTools: DISALLOWED_TOOLS,
    mcpServers: {}, // no MCP servers
    strictMcpConfig: true, // ignore .mcp.json / settings MCP
    settingSources: [], // do NOT load ~/.claude, project .claude, CLAUDE.md, skills, commands
    skills: [], // no skills
    permissionMode: 'default',
    maxTurns: 1, // single-turn unless a route manages a conversation
    includePartialMessages: input.includePartialMessages ?? false,
    env: sanitizedEnv(),
    cwd: input.cwd ?? tmpdir(),
  };
  if (input.abortController) options.abortController = input.abortController;
  if (input.persistSession !== undefined) options.persistSession = input.persistSession;
  return options;
}
