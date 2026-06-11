interface FileLite {
  path: string;
  content: string;
}

/** Accepts both `ChatContext` and the zod-parsed shape (explicit `undefined`s). */
interface ContextInput {
  activeFile?: string | undefined;
  selection?: string | undefined;
  cursorLine?: number | undefined;
  pinnedPaths?: string[] | undefined;
}

/** Character budget for the assembled context (~4 chars/token ⇒ ~6k tokens). */
export const DEFAULT_CONTEXT_BUDGET = 24_000;

/**
 * Assemble the editor context block for a chat query, under an explicit budget.
 * Priority: selection > the active file windowed around the cursor > pinned
 * files (in order). The window keeps the region around the cursor.
 */
export function assembleContext(
  files: FileLite[],
  ctx: ContextInput | undefined,
  budget: number = DEFAULT_CONTEXT_BUDGET,
): string {
  if (!ctx) return '';
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const sections: string[] = [];
  let remaining = budget;

  if (ctx.selection?.trim()) {
    const text = truncate(ctx.selection, Math.min(remaining, 6_000));
    sections.push(`Selected text:\n${text}`);
    remaining -= text.length;
  }

  if (ctx.activeFile && remaining > 200) {
    const content = byPath.get(ctx.activeFile);
    if (content !== undefined) {
      const windowed = windowAroundLine(content, ctx.cursorLine, Math.min(remaining, 12_000));
      sections.push(`File ${ctx.activeFile} (around the cursor):\n${windowed}`);
      remaining -= windowed.length;
    }
  }

  for (const path of ctx.pinnedPaths ?? []) {
    if (remaining < 300) break;
    if (path === ctx.activeFile) continue;
    const content = byPath.get(path);
    if (content === undefined) continue;
    const block = truncate(content, remaining - 100);
    sections.push(`Pinned file ${path}:\n${block}`);
    remaining -= block.length + 100;
  }

  return sections.join('\n\n');
}

function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  return s.length <= max ? s : `${s.slice(0, max)}\n… [truncated]`;
}

/** Keep `max` characters of `content` centred on a 1-based line. */
export function windowAroundLine(content: string, line: number | undefined, max: number): string {
  if (content.length <= max) return content;
  const lines = content.split('\n');
  const center = Math.max(0, Math.min(lines.length - 1, (line ?? 1) - 1));
  let lo = center;
  let hi = center;
  let size = lines[center]?.length ?? 0;
  while (size < max && (lo > 0 || hi < lines.length - 1)) {
    if (lo > 0) {
      lo -= 1;
      size += (lines[lo]?.length ?? 0) + 1;
    }
    if (hi < lines.length - 1) {
      hi += 1;
      size += (lines[hi]?.length ?? 0) + 1;
    }
  }
  const head = lo > 0 ? '… [earlier lines truncated]\n' : '';
  const tail = hi < lines.length - 1 ? '\n… [later lines truncated]' : '';
  return head + lines.slice(lo, hi + 1).join('\n') + tail;
}
