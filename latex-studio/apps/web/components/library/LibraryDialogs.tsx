'use client';

import { useState } from 'react';
import { FileText, RotateCcw, Trash2, X } from 'lucide-react';
import { useLibraryStore } from '@/lib/libraryStore';

function kb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Confirm before accepting uploaded PDFs (name + size shown). */
export function UploadConfirmDialog() {
  const pending = useLibraryStore((s) => s.pendingUpload);
  const confirm = useLibraryStore((s) => s.confirmUpload);
  const cancel = useLibraryStore((s) => s.cancelUpload);
  if (!pending) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={cancel}>
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Confirm upload">
        <div className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-700">Add {pending.files.length} PDF(s) to the library?</div>
        <ul className="max-h-60 overflow-auto px-4 py-3 text-sm">
          {pending.files.map((f) => (
            <li key={f.name} className="flex items-center gap-2 py-0.5 text-zinc-600 dark:text-zinc-300">
              <FileText className="h-4 w-4 shrink-0 text-violet-400" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-zinc-400">{kb(f.size)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <button type="button" onClick={cancel} className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">Cancel</button>
          <button type="button" data-testid="upload-confirm" onClick={() => void confirm()} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900">Add to library</button>
        </div>
      </div>
    </div>
  );
}

export function TrashDialog() {
  const open = useLibraryStore((s) => s.trashOpen);
  const close = useLibraryStore((s) => s.closeTrash);
  const items = useLibraryStore((s) => s.trashItems);
  const restore = useLibraryStore((s) => s.restore);
  const empty = useLibraryStore((s) => s.empty);
  const [confirming, setConfirming] = useState(false);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={close}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Trash">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Trash2 className="h-4 w-4" /> Trash</h2>
          <button type="button" onClick={close} aria-label="Close" className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-2 text-sm">
          {items.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-400">Trash is empty.</p>
          ) : (
            <ul>
              {items.map((t) => (
                <li key={t.id} className="flex items-center gap-2 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
                  <span className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-200">{t.label}</span>
                  <button type="button" data-testid="trash-restore" onClick={() => void restore(t.id)} className="inline-flex items-center gap-1 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                    <RotateCcw className="h-3 w-3" /> Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-400">Nothing is permanently removed until you empty the trash.</p>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600">Permanently delete everything in trash?</span>
              <button type="button" data-testid="trash-empty-confirm" onClick={() => { setConfirming(false); void empty(); }} className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500">Yes, empty</button>
              <button type="button" onClick={() => setConfirming(false)} className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700">Cancel</button>
            </div>
          ) : (
            <button type="button" data-testid="trash-empty" disabled={items.length === 0} onClick={() => setConfirming(true)} className="rounded border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10">
              Empty trash…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
