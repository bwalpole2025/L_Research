import type { ReviewFinding, SyncForwardResult } from '@latex-studio/shared';

export interface FindingRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FindingCoord {
  page: number;
  rects: FindingRect[];
  approximate: boolean;
}

export type ForwardFn = (file: string, line: number) => Promise<SyncForwardResult>;

/**
 * Map each finding's source line onto PDF coordinates via SyncTeX forward search.
 * If a line yields nothing (common for some maths), fall back to the nearest
 * mapped line and flag the location approximate.
 */
export async function mapFindingsToPdf(findings: ReviewFinding[], forward: ForwardFn): Promise<Map<string, FindingCoord>> {
  const coords = new Map<string, FindingCoord>();
  const cache = new Map<string, SyncForwardResult>();

  const lookup = async (file: string, line: number): Promise<SyncForwardResult> => {
    if (line < 1) return { boxes: [] };
    const key = `${file}:${line}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let res: SyncForwardResult;
    try {
      res = await forward(file, line);
    } catch {
      res = { boxes: [] };
    }
    cache.set(key, res);
    return res;
  };

  for (const f of findings) {
    const line = f.lineSpan.fromLine;
    let res = await lookup(f.file, line);
    let approximate = false;
    if (res.boxes.length === 0) {
      for (const delta of [1, -1, 2, -2, 3, -3]) {
        const near = await lookup(f.file, line + delta);
        if (near.boxes.length > 0) {
          res = near;
          approximate = true;
          break;
        }
      }
    }
    if (res.boxes.length === 0) continue; // no PDF location — still listed in panel + index
    const page = res.boxes[0]!.page;
    const rects = res.boxes
      .filter((b) => b.page === page)
      .map((b) => ({ x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }));
    coords.set(f.id, { page, rects, approximate });
  }

  return coords;
}
