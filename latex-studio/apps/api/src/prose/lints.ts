import type { ProseDiagnostic, ProseRuleToggles } from '@latex-studio/shared';
import { type ProseMap, proseOffsetToPosition } from './strip.js';

/** Common American → British spelling variants (consistency lint). */
const US_TO_GB: Record<string, string> = {
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring',
  behavior: 'behaviour', behaviors: 'behaviours', neighbor: 'neighbour', neighbors: 'neighbours',
  center: 'centre', centers: 'centres', centered: 'centred', fiber: 'fibre', fibers: 'fibres',
  meter: 'metre', meters: 'metres', liter: 'litre', liters: 'litres',
  organize: 'organise', organized: 'organised', organization: 'organisation',
  analyze: 'analyse', analyzed: 'analysed', analyzing: 'analysing',
  modeling: 'modelling', modeled: 'modelled', labeled: 'labelled', labeling: 'labelling',
  traveled: 'travelled', traveling: 'travelling', canceled: 'cancelled',
  defense: 'defence', license: 'licence', favor: 'favour', favorite: 'favourite',
  gray: 'grey', catalog: 'catalogue', dialog: 'dialogue', program: 'programme',
  normalize: 'normalise', normalized: 'normalised', generalize: 'generalise',
  minimize: 'minimise', maximize: 'maximise', summarize: 'summarise', emphasize: 'emphasise',
};

function pos(pm: ProseMap, offset: number): { line: number; column: number } {
  return proseOffsetToPosition(pm, offset);
}

/** Consistency lints over the stripped prose (positions mapped to source). */
export function runLints(pm: ProseMap, file: string, rules: ProseRuleToggles): ProseDiagnostic[] {
  const out: ProseDiagnostic[] = [];
  const prose = pm.prose;

  // Collect lowercase tokens present (for mixed-spelling detection).
  const tokens = new Set<string>();
  for (const m of prose.matchAll(/[A-Za-z][A-Za-z'’-]*/g)) tokens.add(m[0].toLowerCase());

  // en-GB consistency: flag a US spelling only when its GB counterpart also appears.
  if (rules.enGbConsistency) {
    for (const m of prose.matchAll(/[A-Za-z][A-Za-z]*/g)) {
      const word = m[0];
      const gb = US_TO_GB[word.toLowerCase()];
      if (gb && tokens.has(gb.toLowerCase())) {
        const p = pos(pm, m.index ?? 0);
        out.push({
          file, line: p.line, column: p.column, endColumn: p.column + word.length,
          severity: 'info', rule: 'en-gb',
          message: `American spelling "${word}" — this document also uses "${gb}" (British)`,
          suggestions: [gb], word,
        });
      }
    }
  }

  // Double spaces between words.
  if (rules.doubleSpace) {
    for (const m of prose.matchAll(/\S(  +)\S/g)) {
      const p = pos(pm, (m.index ?? 0) + 1);
      out.push({
        file, line: p.line, column: p.column,
        severity: 'info', rule: 'double-space',
        message: 'Multiple consecutive spaces', suggestions: [' '],
      });
    }
  }

  // Straight vs curly quote mixing — flag straight quotes when curly are also used.
  if (rules.quotes) {
    const hasCurly = /[“”‘’]/.test(prose);
    if (hasCurly) {
      for (const m of prose.matchAll(/["']/g)) {
        const p = pos(pm, m.index ?? 0);
        out.push({
          file, line: p.line, column: p.column,
          severity: 'info', rule: 'quotes',
          message: 'Straight quote mixed with curly quotes', suggestions: [],
        });
      }
    }
  }

  // Inconsistent hyphenation: "a-b" used alongside "ab".
  if (rules.hyphenation) {
    const seen = new Set<string>();
    for (const m of prose.matchAll(/([A-Za-z]{2,})-([A-Za-z]{2,})/g)) {
      const joined = `${m[1]}${m[2]}`.toLowerCase();
      const key = `${m[0].toLowerCase()}|${joined}`;
      if (!seen.has(key) && tokens.has(joined)) {
        seen.add(key);
        const p = pos(pm, m.index ?? 0);
        out.push({
          file, line: p.line, column: p.column, endColumn: p.column + m[0].length,
          severity: 'info', rule: 'hyphenation',
          message: `"${m[0]}" is also written "${joined}" — inconsistent hyphenation`,
          suggestions: [joined], word: m[0],
        });
      }
    }
  }

  return out;
}
