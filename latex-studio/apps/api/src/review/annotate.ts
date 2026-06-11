import type { MathCounterexample, ReviewFinding } from '@latex-studio/shared';
import { reviewStyle } from '@latex-studio/shared';
import type { FindingCoord } from './coords.js';

function formatCx(c: MathCounterexample): string {
  const vals = Object.entries(c.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}lhs=${c.lhsVal}, rhs=${c.rhsVal}`;
}

/** Human-readable popup text for a finding (category, confidence-in-words, message, …). */
export function buildPopup(f: ReviewFinding, approximate: boolean): string {
  const style = reviewStyle(f.axis, f.confidence);
  const parts = [`${f.axis.toUpperCase()} · ${f.category}`, `Confidence: ${style.label}`, f.message];
  if (f.suggestion) parts.push(`Suggestion: ${f.suggestion}`);
  if (f.counterexample) parts.push(`SymPy counterexample: ${formatCx(f.counterexample)}`);
  if (f.reference) parts.push(`Reference: [${f.reference}]${f.quotedSpan ? ` — "${f.quotedSpan}"` : ''}`);
  if (approximate) parts.push('(approximate location)');
  return parts.join('\n');
}

interface AnnotateItem {
  id: string;
  axis: string;
  severity: string;
  page: number;
  rects: [number, number, number, number][];
  color: [number, number, number];
  popup: string;
  indexLabel: string;
}

/** Send the clean PDF + located findings to mathcheck's PyMuPDF annotator. */
export async function annotatePdf(
  mathcheckUrl: string,
  pdfBase64: string,
  findings: ReviewFinding[],
  coords: Map<string, FindingCoord>,
): Promise<{ pdfBase64: string; annotations: number } | null> {
  const items: AnnotateItem[] = [];
  for (const f of findings) {
    const c = coords.get(f.id);
    if (!c) continue;
    const style = reviewStyle(f.axis, f.confidence);
    items.push({
      id: f.id,
      axis: f.axis,
      severity: f.severity,
      page: c.page,
      rects: c.rects.map((r) => [r.x0, r.y0, r.x1, r.y1]),
      color: style.rgb,
      popup: buildPopup(f, c.approximate),
      indexLabel: `${f.severity} · ${f.message.slice(0, 90)}`,
    });
  }
  if (items.length === 0) return null;

  let res: Response;
  try {
    res = await fetch(`${mathcheckUrl}/annotate-pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdf_base64: pdfBase64, findings: items }),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { pdf_base64?: string | null; annotations?: number; error?: string };
  if (!data.pdf_base64) return null;
  return { pdfBase64: data.pdf_base64, annotations: data.annotations ?? items.length };
}
