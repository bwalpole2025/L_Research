/**
 * Parsers for the `synctex` CLI's textual output.
 *
 * `synctex view -i line:col:file -o out.pdf` (forward search) emits one or more
 * Page/x/y/h/v/W/H records. `synctex edit -o page:x:y:out.pdf` (inverse search)
 * emits Input/Line/Column. Coordinates are in PDF points with a top-left origin.
 */

export interface SynctexViewRecord {
  page: number;
  /** Hot-point coordinates (points, top-left origin). */
  x: number;
  y: number;
  /** Enclosing box: top-left (h, v) and size (W, H). */
  h: number;
  v: number;
  W: number;
  H: number;
}

export interface SynctexEditRecord {
  file: string;
  line: number;
  column: number;
}

const NUMERIC_KEYS = new Set(['x', 'y', 'h', 'v', 'W', 'H']);

export function parseSynctexView(stdout: string): SynctexViewRecord[] {
  const records: SynctexViewRecord[] = [];
  let cur: Partial<SynctexViewRecord> | null = null;

  const finalize = (r: Partial<SynctexViewRecord>): SynctexViewRecord => ({
    page: r.page ?? 0,
    x: r.x ?? 0,
    y: r.y ?? 0,
    h: r.h ?? 0,
    v: r.v ?? 0,
    W: r.W ?? 0,
    H: r.H ?? 0,
  });

  for (const raw of stdout.split(/\r?\n/)) {
    const m = /^([A-Za-z]+):(-?[\d.]+)\s*$/.exec(raw.trim());
    if (!m) continue;
    const key = m[1] ?? '';
    const value = Number.parseFloat(m[2] ?? '');
    if (key === 'Page') {
      if (cur && cur.page !== undefined) records.push(finalize(cur));
      cur = { page: Number.parseInt(m[2] ?? '', 10) };
    } else if (cur && NUMERIC_KEYS.has(key)) {
      (cur as Record<string, number>)[key] = value;
    }
  }
  if (cur && cur.page !== undefined) records.push(finalize(cur));
  return records.filter((r) => Number.isFinite(r.page) && r.page > 0);
}

export function parseSynctexEdit(stdout: string): SynctexEditRecord | null {
  let file: string | undefined;
  let line: number | undefined;
  let column = 0;
  let sawColumn = false;

  for (const raw of stdout.split(/\r?\n/)) {
    const m = /^(Input|Line|Column):(.+)$/.exec(raw.trim());
    if (!m) continue;
    const key = m[1];
    const value = (m[2] ?? '').trim();
    if (key === 'Input' && file === undefined) {
      file = value;
    } else if (key === 'Line' && line === undefined) {
      line = Number.parseInt(value, 10);
    } else if (key === 'Column' && !sawColumn) {
      column = Number.parseInt(value, 10);
      sawColumn = true;
    }
    if (file !== undefined && line !== undefined && sawColumn) break;
  }

  if (file === undefined || line === undefined || !Number.isFinite(line)) return null;
  return { file, line, column: Number.isFinite(column) ? column : 0 };
}
