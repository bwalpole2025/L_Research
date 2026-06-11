import type {
  CoderiveAnchorRange,
  CoderiveIntent,
  ContextBundle,
  ContextBundleSummary,
} from '@latex-studio/shared';
import { windowAroundLine } from '../ai/context.js';
import { buildReferences, type LibraryRef, type RefFile } from './references.js';
import { resolveAnchors, type ResolvedAnchors } from './anchors.js';

export interface BundleInput {
  intent: CoderiveIntent;
  range: CoderiveAnchorRange;
  target?: string;
  targetFile: { path: string; content: string };
  files: RefFile[];
  macros: Record<string, string>;
  assumptions: string;
  /** Linked Literature-library articles, keyed by cite key. */
  libraryItems?: Map<string, LibraryRef>;
}

const CITE_RE = /\\(?:cite|citep|citet|citeauthor|citeyear|parencite|textcite)\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;

function citedKeys(content: string): string[] {
  const keys = new Set<string>();
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(content)) !== null) {
    for (const k of (m[1] ?? '').split(',')) {
      const t = k.trim();
      if (t) keys.add(t);
    }
  }
  return [...keys];
}

export async function assembleBundle(input: BundleInput): Promise<{ bundle: ContextBundle; anchors: ResolvedAnchors }> {
  const anchors = resolveAnchors(input.targetFile.content, input.intent, input.range, input.target);
  const documentWindow = windowAroundLine(input.targetFile.content, input.range.fromLine, 6000);
  const references = await buildReferences(citedKeys(input.targetFile.content), input.files, documentWindow, input.libraryItems);

  const bundle: ContextBundle = {
    macros: input.macros,
    assumptions: input.assumptions,
    documentWindow,
    references,
    intent: input.intent,
    anchors: {
      ...(anchors.from ? { from: anchors.from } : {}),
      ...(anchors.to ? { to: anchors.to } : {}),
      ...(anchors.goal ? { goal: anchors.goal } : {}),
    },
  };
  return { bundle, anchors };
}

export function summariseBundle(b: ContextBundle): ContextBundleSummary {
  return {
    macroCount: Object.keys(b.macros).length,
    assumptions: b.assumptions,
    documentWindowChars: b.documentWindow.length,
    windowPreview: b.documentWindow.slice(0, 1200),
    references: b.references.map((r) => ({
      key: r.key,
      provenance: r.provenance,
      ...(r.sourceFile ? { sourceFile: r.sourceFile } : {}),
      passageCount: r.passages?.length ?? 0,
      ...(r.library ? { library: true } : {}),
    })),
  };
}
