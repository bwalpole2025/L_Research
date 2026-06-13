import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Diagnostic, DiagnosticSeverity, ModelProvider } from '@latex-studio/shared';
import type { AppConfig } from '../config.js';
import type { ProjectFileInput } from '../compile/runner.js';
import { projectDir, stageFiles } from '../run/runner.js';

/**
 * AI-assisted Python error checking. Two layers, mirroring the app's
 * "deterministic where possible, AI for judgement" ethos (cf. the SymPy maths
 * audit):
 *   1. A DETERMINISTIC syntax check — Python's own `compile()` run in the pyrun
 *      sandbox (read-only mount, no byte-code written), giving exact line/column
 *      for real SyntaxErrors.
 *   2. An AI logic/bug review via the project's model provider (the same path
 *      chat/review/co-derive use), for runtime risks, undefined names, and logic
 *      errors that a parser can't see.
 * Both produce the shared `Diagnostic` shape so they render inline (lint gutter)
 * and in the Problems panel with the existing "Fix with Claude" affordance.
 */

export interface PythonCheckDeps {
  config: AppConfig;
  modelProvider: ModelProvider;
  model: string;
}

export interface PythonCheckResult {
  diagnostics: Diagnostic[];
  /** True when the deterministic parser found no SyntaxError. */
  syntaxOk: boolean;
  /** True when the AI review ran and returned (possibly empty) results. */
  aiProvided: boolean;
  checkedPath: string;
}

// ── 1. Deterministic syntax check (sandboxed) ────────────────────────────────

// `compile()` raises SyntaxError with line/offset before executing anything and
// writes NO files, so the project can stay mounted read-only.
const SYNTAX_SNIPPET = `import json, sys
p = sys.argv[1]
try:
    src = open(p, encoding="utf-8").read()
except Exception as e:
    print(json.dumps([{"line": 1, "col": 1, "msg": "cannot read file: %s" % e}])); sys.exit(0)
try:
    compile(src, p, "exec")
    print("[]")
except SyntaxError as e:
    print(json.dumps([{"line": e.lineno or 1, "col": e.offset or 1, "msg": e.msg or "syntax error"}]))
except Exception as e:
    print(json.dumps([{"line": 1, "col": 1, "msg": "compile failed: %s" % e}]))
`;

function syntaxCommand(config: AppConfig, projectId: string, scriptPath: string): { command: string; argv: string[]; cwd?: string } {
  if (config.pyrunMode === 'local') {
    return { command: 'python3', argv: ['-c', SYNTAX_SNIPPET, scriptPath], cwd: projectDir(config, projectId) };
  }
  const projHost = join(config.pyrunWorkspaceHost, projectId);
  return {
    command: 'docker',
    argv: [
      'run', '--rm', '--network', 'none', '--user', config.pyrunUser,
      '-v', `${projHost}:/workspace:ro`, '-w', '/workspace',
      config.pyrunImage, 'python', '-c', SYNTAX_SNIPPET, scriptPath,
    ],
  };
}

function execCapture(command: string, argv: string[], cwd: string | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const done = (): void => { if (!settled) { settled = true; resolve(out); } };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, argv, { ...(cwd ? { cwd } : {}), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      return resolve('');
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', () => { clearTimeout(timer); done(); });
    child.on('close', () => { clearTimeout(timer); done(); });
  });
}

async function syntaxDiagnostics(config: AppConfig, projectId: string, scriptPath: string): Promise<Diagnostic[]> {
  const { command, argv, cwd } = syntaxCommand(config, projectId, scriptPath);
  const stdout = await execCapture(command, argv, cwd, Math.min(config.pyrunTimeoutMs, 30_000));
  let parsed: Array<{ line?: number; col?: number; msg?: string }> = [];
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try { parsed = JSON.parse(stdout.slice(start, end + 1)); } catch { parsed = []; }
  }
  return parsed
    .filter((e) => e && typeof e.msg === 'string')
    .map((e) => ({
      severity: 'error' as DiagnosticSeverity,
      category: 'syntax',
      message: `SyntaxError: ${e.msg}`,
      file: scriptPath,
      line: typeof e.line === 'number' && e.line > 0 ? e.line : 1,
      ...(typeof e.col === 'number' && e.col > 0 ? { column: e.col } : {}),
    }));
}

// ── 2. AI logic / bug review (model provider) ────────────────────────────────

const AI_SYSTEM_PROMPT =
  'You are a meticulous Python code reviewer. Report ONLY real defects: bugs and likely runtime errors ' +
  '(undefined names / use-before-assignment, NameError, TypeError, wrong argument count or keyword, ' +
  'AttributeError, IndexError/KeyError, calling non-callables), incorrect logic, mutable default arguments, ' +
  'unclosed resources, and clear correctness anti-patterns. Do NOT report formatting, line length, naming ' +
  'style, or import ordering. Be conservative: only flag issues you are confident are real. ' +
  'Use the provided 1-based line numbers. For each issue give: line, severity ("error" for a definite ' +
  'bug/crash, "warning" for a likely bug, "info" for a minor risk), a short category (e.g. "undefined-name", ' +
  '"type", "logic", "resource"), a one-sentence message, and an optional one-line suggestion. ' +
  'Output ONLY a JSON array: [{"line":N,"severity":"error|warning|info","category":"...","message":"...","suggestion":"..."}]. ' +
  'No prose, no markdown fences. If there are no real issues, output [].';

function buildAiUserPrompt(path: string, source: string): string {
  const numbered = source.split('\n').map((l, i) => `${i + 1}\t${l}`).join('\n');
  return `File: ${path}\n\nSource (each line prefixed with its 1-based number):\n${numbered}\n\nReturn the JSON array now.`;
}

function mapSeverity(s: unknown): DiagnosticSeverity {
  if (s === 'error') return 'error';
  if (s === 'warning') return 'warning-important';
  if (s === 'info') return 'info';
  return 'warning-minor';
}

function parseAiDiagnostics(text: string, path: string): Diagnostic[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: Diagnostic[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const msg = typeof it.message === 'string' ? it.message.trim() : '';
    if (!msg) continue;
    const line = typeof it.line === 'number' && it.line > 0 ? Math.floor(it.line) : undefined;
    const suggestion = typeof it.suggestion === 'string' && it.suggestion.trim() ? ` — ${it.suggestion.trim()}` : '';
    out.push({
      severity: mapSeverity(it.severity),
      category: typeof it.category === 'string' && it.category.trim() ? it.category.trim() : 'ai',
      message: `${msg}${suggestion}`,
      file: path,
      ...(line ? { line } : {}),
    });
  }
  return out;
}

async function aiDiagnostics(deps: PythonCheckDeps, path: string, source: string, signal?: AbortSignal): Promise<Diagnostic[]> {
  let text = '';
  for await (const delta of deps.modelProvider.chatStream(
    { system: AI_SYSTEM_PROMPT, messages: [{ role: 'user', content: buildAiUserPrompt(path, source) }], model: deps.model },
    signal,
  )) {
    text += delta.text;
  }
  return parseAiDiagnostics(text, path);
}

// ── orchestration ────────────────────────────────────────────────────────────

export async function checkPython(
  deps: PythonCheckDeps,
  projectId: string,
  scriptPath: string,
  files: ProjectFileInput[],
  source: string,
  signal?: AbortSignal,
): Promise<PythonCheckResult> {
  await stageFiles(deps.config, projectId, files); // so the parser sees current content
  const syntax = await syntaxDiagnostics(deps.config, projectId, scriptPath);

  let ai: Diagnostic[] = [];
  let aiProvided = false;
  try {
    ai = await aiDiagnostics(deps, scriptPath, source, signal);
    aiProvided = true;
  } catch {
    ai = []; // AI is best-effort; the deterministic syntax verdict stands alone
    aiProvided = false;
  }

  // Don't double-report a line the deterministic parser already flagged as a syntax error.
  const syntaxLines = new Set(syntax.map((d) => d.line).filter((n): n is number => typeof n === 'number'));
  const merged = [...syntax, ...ai.filter((d) => !(typeof d.line === 'number' && syntaxLines.has(d.line)))];
  merged.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));

  return { diagnostics: merged, syntaxOk: syntax.length === 0, aiProvided, checkedPath: scriptPath };
}
