'use client';

import { useEffect, useState } from 'react';
import { History, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { ApiError } from '@/lib/api';

function reportError(err: unknown): void {
  window.alert(err instanceof ApiError ? err.message : 'Something went wrong');
}

export function SnapshotsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const snapshots = useEditorStore((s) => s.snapshots);
  const refreshSnapshots = useEditorStore((s) => s.refreshSnapshots);
  const createSnapshot = useEditorStore((s) => s.createSnapshot);
  const restoreSnapshot = useEditorStore((s) => s.restoreSnapshot);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void refreshSnapshots();
  }, [open, refreshSnapshots]);

  if (!open) return null;

  const create = async () => {
    const label = window.prompt('Snapshot label', `Snapshot ${new Date().toLocaleString()}`);
    if (!label?.trim()) return;
    setBusy(true);
    try {
      await createSnapshot(label.trim());
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string, label: string) => {
    if (!window.confirm(`Restore "${label}"? This replaces the project's current files.`)) return;
    setBusy(true);
    try {
      await restoreSnapshot(id);
      onClose();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Snapshots"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" /> Snapshots
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-2 py-2">
          {snapshots.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-400">
              No snapshots yet. Create one to capture the current state of your files.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {snapshots.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded px-2 py-2 hover:bg-slate-100 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.label}</p>
                    <p className="text-xs text-slate-400">{new Date(s.createdAt).toLocaleString()}</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restore(s.id, s.label)}
                    className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            disabled={busy}
            onClick={() => void create()}
            className="w-full rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Create snapshot
          </button>
        </div>
      </div>
    </div>
  );
}
