'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download, Loader2, Save } from 'lucide-react';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { api, ApiError } from '@/lib/api';
import { loadLastProject, loadTheme } from '@/lib/persist';

/**
 * Visual diagram editor — a full-page Excalidraw canvas, reached from the Studio
 * toolbar. The editable scene is stored in the project as diagrams/diagram.excalidraw
 * (so it travels with the project and reopens), and "Export to figures/" renders it
 * to figures/diagram.png — immediately usable from LaTeX via \includegraphics.
 */

// Excalidraw touches `window`, so it must load client-side only.
const Excalidraw = dynamic(() => import('@excalidraw/excalidraw').then((m) => m.Excalidraw), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-[var(--ls-muted)]">Loading diagram editor…</div>,
});

const SCENE_PATH = 'diagrams/diagram.excalidraw';
const FIGURE_PATH = 'figures/diagram.png';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Create the file or update it in place (figures + scenes are single-home). */
async function upsertFile(projectId: string, path: string, content: string, encoding: 'utf8' | 'base64'): Promise<void> {
  const files = await api.listFiles(projectId);
  const existing = files.find((f) => f.path === path);
  if (existing) await api.updateFile(existing.id, { content });
  else await api.createFile(projectId, path, content, encoding);
}

export function DiagramEditor() {
  const router = useRouter();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'save' | 'export' | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const theme = (loadTheme() ?? 'light') as 'light' | 'dark';

  // Match the app theme on this standalone route (the editor store doesn't run here).
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Resolve the current project and load its saved scene (if any).
  useEffect(() => {
    const pid = loadLastProject();
    setProjectId(pid);
    if (!pid) {
      setLoaded(true);
      return;
    }
    void api
      .listFiles(pid)
      .then(async (files) => {
        const scene = files.find((f) => f.path === SCENE_PATH);
        if (!scene) {
          setInitialData({ elements: [], scrollToContent: true });
          return;
        }
        try {
          const file = await api.getFile(scene.id);
          const parsed = JSON.parse(file.content) as ExcalidrawInitialDataState;
          setInitialData({ elements: parsed.elements ?? [], appState: parsed.appState ?? {}, files: parsed.files ?? {}, scrollToContent: true });
        } catch {
          setInitialData({ elements: [], scrollToContent: true });
        }
      })
      .catch(() => setInitialData({ elements: [], scrollToContent: true }))
      .finally(() => setLoaded(true));
  }, []);

  const flash = (kind: 'ok' | 'error', text: string) => {
    setNote({ kind, text });
    window.setTimeout(() => setNote((n) => (n?.text === text ? null : n)), 6000);
  };

  const saveScene = async () => {
    if (!apiRef.current || !projectId) return;
    setBusy('save');
    try {
      const { serializeAsJSON } = await import('@excalidraw/excalidraw');
      const json = serializeAsJSON(apiRef.current.getSceneElements(), apiRef.current.getAppState(), apiRef.current.getFiles(), 'local');
      await upsertFile(projectId, SCENE_PATH, json, 'utf8');
      flash('ok', `Saved ${SCENE_PATH}`);
    } catch (e) {
      flash('error', e instanceof ApiError ? e.message : 'Could not save the scene.');
    } finally {
      setBusy(null);
    }
  };

  const exportFigure = async () => {
    if (!apiRef.current || !projectId) return;
    setBusy('export');
    try {
      const { exportToBlob, serializeAsJSON } = await import('@excalidraw/excalidraw');
      const elements = apiRef.current.getSceneElements();
      if (elements.length === 0) {
        flash('error', 'Nothing to export — draw something first.');
        return;
      }
      const blob = await exportToBlob({
        elements,
        appState: { ...apiRef.current.getAppState(), exportBackground: true, exportWithDarkMode: false },
        files: apiRef.current.getFiles(),
        mimeType: 'image/png',
        quality: 1,
      });
      const b64 = await blobToBase64(blob);
      await upsertFile(projectId, FIGURE_PATH, b64, 'base64');
      // Persist the editable scene alongside the rendered figure.
      const json = serializeAsJSON(elements, apiRef.current.getAppState(), apiRef.current.getFiles(), 'local');
      await upsertFile(projectId, SCENE_PATH, json, 'utf8');
      flash('ok', `Exported ${FIGURE_PATH} — include it with \\includegraphics{${FIGURE_PATH}}`);
    } catch (e) {
      flash('error', e instanceof ApiError ? e.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-screen flex-col bg-[var(--ls-bg)]">
      {/* Top bar */}
      <header className="flex h-12 flex-none items-center justify-between gap-3 border-b border-[var(--ls-line)] bg-[var(--ls-editor-bg)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/studio')}
            className="flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[13px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
          >
            <ArrowLeft className="h-4 w-4" /> Studio
          </button>
          <div className="h-5 w-px bg-[var(--ls-line-strong)]" />
          <span className="truncate text-[15px] text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
            Visual diagram editor
          </span>
        </div>
        <div className="flex flex-none items-center gap-2">
          {note && (
            <span className={`max-w-[420px] truncate text-[12.5px] ${note.kind === 'error' ? 'text-rose-500' : 'text-emerald-500'}`}>{note.text}</span>
          )}
          <button
            type="button"
            data-testid="diagram-save"
            disabled={!projectId || busy !== null}
            onClick={() => void saveScene()}
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--ls-line)] px-3 py-1.5 text-[13px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)] disabled:opacity-50"
          >
            {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save scene
          </button>
          <button
            type="button"
            data-testid="diagram-export"
            disabled={!projectId || busy !== null}
            onClick={() => void exportFigure()}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[var(--ls-brand)] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {busy === 'export' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export to figures/
          </button>
        </div>
      </header>

      {/* Canvas */}
      <div className="min-h-0 flex-1">
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--ls-muted)]">Loading…</div>
        ) : !projectId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-[14px] text-[var(--ls-muted)]">Open a project first, then come back to draw its diagram.</p>
            <Link href="/files" className="rounded-[9px] bg-[var(--ls-brand)] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90">
              Go to projects
            </Link>
          </div>
        ) : (
          initialData !== null && (
            <Excalidraw
              excalidrawAPI={(instance) => {
                apiRef.current = instance;
              }}
              initialData={initialData}
              theme={theme}
            />
          )
        )}
      </div>
    </div>
  );
}
