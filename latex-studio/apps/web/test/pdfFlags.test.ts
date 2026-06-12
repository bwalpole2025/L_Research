import { describe, expect, it } from 'vitest';
import { MAX_PDF_FLAGS, checkerFlagCandidates, compileFlagCandidates } from '../lib/pdfFlags';
import type { Diagnostic, MathAuditBlock } from '@latex-studio/shared';

const diag = (severity: Diagnostic['severity'], file?: string, line?: number, message = 'msg'): Diagnostic => ({
  severity,
  message,
  ...(file ? { file } : {}),
  ...(line ? { line } : {}),
});

const block = (verdict: MathAuditBlock['verdict'], line = 5, message?: string): MathAuditBlock => ({
  id: `b${line}`,
  file: 'main.tex',
  lineStart: line,
  lineEnd: line,
  verdict,
  latex: 'a = b',
  ...(message ? { message } : {}),
});

describe('compileFlagCandidates', () => {
  it('keeps only orange/yellow with a real source line — red means no PDF, nothing to highlight', () => {
    const out = compileFlagCandidates([
      diag('error', 'main.tex', 3),
      diag('warning-important', 'main.tex', 7, 'undefined ref'),
      diag('warning-important'), // rerun hint — no location
      diag('warning-minor', 'main.tex', 9, 'overfull'),
      diag('info', 'main.tex', 2),
    ]);
    expect(out).toEqual([
      { severity: 'warning-important', message: 'undefined ref', file: 'main.tex', line: 7 },
      { severity: 'warning-minor', message: 'overfull', file: 'main.tex', line: 9 },
    ]);
  });

  it('dedupes by file:line keeping the first (highest-tier) message, and caps the fan-out', () => {
    const dupes = compileFlagCandidates([
      diag('warning-important', 'a.tex', 4, 'first'),
      diag('warning-minor', 'a.tex', 4, 'second'),
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0]).toMatchObject({ severity: 'warning-important', message: 'first' });

    const many = compileFlagCandidates(Array.from({ length: 200 }, (_, i) => diag('warning-minor', 'a.tex', i + 1)));
    expect(many).toHaveLength(MAX_PDF_FLAGS);
  });
});

describe('checkerFlagCandidates', () => {
  it('flags failing AND unknown blocks (both need eyes), never passed ones', () => {
    const out = checkerFlagCandidates([
      block('passed', 3),
      block('failing', 5, '2 = 3 is false'),
      block('unknown', 8),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ severity: 'checker', file: 'main.tex', line: 5 });
    expect(out[0]!.message).toContain('failing');
    expect(out[0]!.message).toContain('2 = 3 is false');
    expect(out[1]!.message).toContain('unverified');
    expect(out[1]!.message).toContain('a = b'); // falls back to the LaTeX
  });
});
