import type { ProseCheckReport, ProseDiagnostic, ProseRuleToggles } from '@latex-studio/shared';
import { getSpeller } from './speller.js';
import { type ProseMap, proseOffsetToPosition, stripLatex } from './strip.js';
import { runLints } from './lints.js';

export interface ProseInputFile {
  path: string;
  content: string;
}

export interface ProseCheckOptions {
  rules: ProseRuleToggles;
  customWords: string[];
  /** URL of a LOCAL LanguageTool container; when unset, only the local passes run. */
  languageToolUrl?: string;
}

export const DEFAULT_PROSE_RULES: ProseRuleToggles = {
  spelling: true,
  enGbConsistency: true,
  hyphenation: true,
  doubleSpace: true,
  quotes: true,
  languageTool: false,
};

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/** LaTeX-aware prose check — fully local unless a LanguageTool container is set. */
export async function checkProse(files: ProseInputFile[], opts: ProseCheckOptions): Promise<ProseCheckReport> {
  const rules = opts.rules;
  const speller = rules.spelling ? await getSpeller() : null;
  const custom = new Set(opts.customWords.map((w) => w.toLowerCase()));
  const diagnostics: ProseDiagnostic[] = [];
  let grammar: string | null = null;

  for (const file of files) {
    const pm = stripLatex(file.content);

    if (speller) {
      for (const m of pm.prose.matchAll(WORD_RE)) {
        const word = m[0];
        if (word.length < 2 || /\d/.test(word)) continue;
        const bare = word.replace(/[’']s$/i, '').replace(/^-+|-+$/g, '');
        if (!bare || custom.has(word.toLowerCase()) || custom.has(bare.toLowerCase())) continue;
        if (speller.correct(word) || speller.correct(bare)) continue;
        const p = proseOffsetToPosition(pm, m.index ?? 0);
        diagnostics.push({
          file: file.path,
          line: p.line,
          column: p.column,
          endColumn: p.column + word.length,
          severity: 'warning',
          rule: 'spelling',
          message: `Possible spelling mistake: "${word}"`,
          suggestions: speller.suggest(bare).slice(0, 5),
          word,
        });
      }
    }

    diagnostics.push(...runLints(pm, file.path, rules));

    if (rules.languageTool && opts.languageToolUrl) {
      try {
        diagnostics.push(...(await callLanguageTool(opts.languageToolUrl, pm, file.path)));
        grammar = 'languagetool';
      } catch {
        /* LanguageTool container unreachable — stay local-only */
      }
    }
  }

  const deduped = dedupe(diagnostics);
  return {
    diagnostics: deduped,
    engine: { spelling: speller ? 'nspell/en-GB' : 'off', grammar, local: true },
    totals: {
      error: deduped.filter((d) => d.severity === 'error').length,
      warning: deduped.filter((d) => d.severity === 'warning').length,
      info: deduped.filter((d) => d.severity === 'info').length,
    },
  };
}

function dedupe(diags: ProseDiagnostic[]): ProseDiagnostic[] {
  const seen = new Map<string, ProseDiagnostic>();
  for (const d of diags) {
    const key = `${d.file}:${d.line}:${d.column}`;
    const existing = seen.get(key);
    if (!existing) seen.set(key, d);
    else if (existing.rule === 'spelling' && d.rule === 'en-gb') seen.set(key, d);
  }
  return [...seen.values()].sort((a, b) => a.line - b.line || a.column - b.column);
}

interface LtMatch {
  offset: number;
  length: number;
  message: string;
  rule?: { id?: string };
  replacements?: Array<{ value: string }>;
}

async function callLanguageTool(url: string, pm: ProseMap, file: string): Promise<ProseDiagnostic[]> {
  const body = new URLSearchParams({ text: pm.prose, language: 'en-GB' });
  const res = await fetch(`${url.replace(/\/$/, '')}/v2/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = (await res.json()) as { matches?: LtMatch[] };
  return (data.matches ?? []).map((m) => {
    const p = proseOffsetToPosition(pm, m.offset);
    return {
      file,
      line: p.line,
      column: p.column,
      endColumn: p.column + m.length,
      severity: 'warning' as const,
      rule: `languagetool:${m.rule?.id ?? 'style'}`,
      message: m.message,
      suggestions: (m.replacements ?? []).slice(0, 5).map((r) => r.value),
    };
  });
}
