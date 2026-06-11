'use client';

import { FileText } from 'lucide-react';
import { isImagePath, mimeForPath } from '@/lib/fileKind';

/** Read-only preview for uploaded binary files (figures/fonts/PDFs). */
export function BinaryFilePreview({ path, base64 }: { path: string; base64?: string | undefined }) {
  const sizeKb = base64 ? Math.max(1, Math.round((base64.length * 3) / 4 / 1024)) : 0;

  if (isImagePath(path) && base64) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 overflow-auto bg-zinc-100 p-6 dark:bg-zinc-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`data:${mimeForPath(path)};base64,${base64}`}
          alt={path}
          className="max-h-[85%] max-w-full rounded-md border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(18,25,38,0.08),0_18px_36px_rgba(18,25,38,0.12)] dark:border-zinc-800"
        />
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {path} · {sizeKb} KB
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 bg-[var(--ls-editor-bg)] text-center">
      <FileText className="h-10 w-10 text-zinc-300 dark:text-zinc-700" />
      <p className="font-medium text-zinc-600 dark:text-zinc-300">{path}</p>
      <p className="max-w-xs text-xs text-zinc-500 dark:text-zinc-400">
        Binary file{sizeKb ? ` (${sizeKb} KB)` : ''}
      </p>
    </div>
  );
}
