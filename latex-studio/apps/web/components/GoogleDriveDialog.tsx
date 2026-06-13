'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronRight,
  Download,
  ExternalLink,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import type { ConnectorStatus, StorageEntry } from '@latex-studio/shared';
import { api, ApiError } from '@/lib/api';
import { useEditorStore } from '@/lib/store';
import { isAllowedPath, isImagePath, sanitiseSegment } from '@/lib/fileKind';
import { useFocusTrap } from '@/lib/a11y';

/**
 * GOOGLE DRIVE — import & upload (construction build).
 *
 * The OAuth connection itself lives on the Connectors page (/plugins): the token
 * is exchanged + stored encrypted server-side and never reaches the browser. This
 * dialog drives the two data flows on top of that connection:
 *   · Import — browse Drive folders and pull a file into the project (text→utf8,
 *     binary→base64), upserting by path.
 *   · Upload — push a project file to a chosen Drive folder.
 * Both call our own api, which holds the token; the browser only ever sees ids.
 */

const CONNECTOR = 'google-drive';
const ROOT: Crumb = { id: 'root', name: 'My Drive' };

interface Crumb {
  id: string;
  name: string;
}

type Tab = 'import' | 'upload';
type Notice = { kind: 'ok' | 'err'; text: string } | null;

function fmtSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Where an imported Drive file lands in the project (null ⇒ unsupported type). */
function importTargetPath(name: string): string | null {
  const seg = sanitiseSegment(name);
  if (!isAllowedPath(seg)) return null;
  return isImagePath(seg) ? `figures/${seg}` : seg;
}

export function GoogleDriveDialog({ open, tab: initialTab, onClose }: { open: boolean; tab: Tab; onClose: () => void }) {
  const projectId = useEditorStore((s) => s.projectId);
  const projectFiles = useEditorStore((s) => s.files);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const refreshFiles = useEditorStore((s) => s.refreshFiles);

  const [status, setStatus] = useState<ConnectorStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT]);
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadFileId, setUploadFileId] = useState<string>('');
  const [notice, setNotice] = useState<Notice>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef);

  const folder = crumbs[crumbs.length - 1] ?? ROOT;
  const connected = !!status?.connected;

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      setStatus(await api.getConnector(CONNECTOR));
    } catch {
      setStatus(null);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadEntries = useCallback(async (folderId: string) => {
    setListLoading(true);
    setListError(null);
    try {
      const { entries: e } = await api.listStorage(CONNECTOR, folderId);
      // Folders first, then files; each group alphabetical.
      e.sort((a, b) => (a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1));
      setEntries(e);
    } catch (err) {
      setEntries([]);
      setListError(err instanceof ApiError ? err.message : 'Could not list this folder.');
      if (err instanceof ApiError && err.status === 409) setStatus((s) => (s ? { ...s, connected: false } : s));
    } finally {
      setListLoading(false);
    }
  }, []);

  // (Re)initialise each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setCrumbs([ROOT]);
    setEntries([]);
    setNotice(null);
    setUploadFileId(activeFileId ?? '');
    void loadStatus();
  }, [open, initialTab, activeFileId, loadStatus]);

  // Browse whenever the connected folder changes.
  useEffect(() => {
    if (!open || !connected) return;
    void loadEntries(folder.id);
  }, [open, connected, folder.id, loadEntries]);

  const openFolder = (e: StorageEntry) => setCrumbs((c) => [...c, { id: e.id, name: e.name }]);
  const gotoCrumb = (i: number) => setCrumbs((c) => c.slice(0, i + 1));

  const doImport = async (e: StorageEntry) => {
    if (!projectId) return;
    const path = importTargetPath(e.name);
    if (!path) return;
    setBusyId(e.id);
    setNotice(null);
    try {
      const meta = await api.importFromStorage(projectId, CONNECTOR, { fileId: e.id, path });
      await refreshFiles().catch(() => undefined);
      setNotice({ kind: 'ok', text: `Imported “${e.name}” → ${meta.path}` });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof ApiError ? err.message : 'Import failed.' });
      if (err instanceof ApiError && err.status === 409) setStatus((s) => (s ? { ...s, connected: false } : s));
    } finally {
      setBusyId(null);
    }
  };

  const doUpload = async () => {
    if (!projectId || !uploadFileId) return;
    const file = projectFiles.find((f) => f.id === uploadFileId);
    setBusyId('upload');
    setNotice(null);
    try {
      const { entry } = await api.uploadToStorage(projectId, CONNECTOR, { fileId: uploadFileId, parentFolderId: folder.id });
      setNotice({ kind: 'ok', text: `Uploaded “${file?.path ?? entry.name}” to ${folder.name}.` });
      if (connected) void loadEntries(folder.id);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof ApiError ? err.message : 'Upload failed.' });
      if (err instanceof ApiError && err.status === 409) setStatus((s) => (s ? { ...s, connected: false } : s));
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Google Drive"
      data-testid="gdrive-dialog"
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--ls-line-strong)] bg-[var(--ls-surface)] shadow-2xl"
        style={{ boxShadow: 'var(--ls-shadow-soft, 0 24px 60px rgba(0,0,0,0.45))' }}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-[var(--ls-line)] px-5 py-3.5">
          <HardDrive className="h-5 w-5 text-[#4e68f5]" />
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
              Google Drive
            </h2>
            {connected && status?.accountLabel && (
              <p className="truncate text-[11px] text-[var(--ls-muted)]">{status.accountLabel}</p>
            )}
          </div>
          <button type="button" aria-label="Close" data-testid="gdrive-close" onClick={onClose} className="ml-auto rounded-md p-1.5 text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {statusLoading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-12 text-sm text-[var(--ls-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking Google Drive…
          </div>
        ) : !connected ? (
          <ConnectPanel status={status} onRecheck={() => void loadStatus()} />
        ) : (
          <>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-[var(--ls-line)] px-3 pt-2">
              <TabButton id="import" active={tab === 'import'} onClick={() => { setTab('import'); setNotice(null); }} icon={<Download className="h-3.5 w-3.5" />} label="Import from Drive" />
              <TabButton id="upload" active={tab === 'upload'} onClick={() => { setTab('upload'); setNotice(null); }} icon={<Upload className="h-3.5 w-3.5" />} label="Upload to Drive" />
            </div>

            {tab === 'upload' && (
              <div className="flex items-center gap-2 border-b border-[var(--ls-line)] px-5 py-2.5">
                <label className="text-[12px] text-[var(--ls-muted)]">File</label>
                <select
                  data-testid="gdrive-filepick"
                  value={uploadFileId}
                  onChange={(e) => setUploadFileId(e.target.value)}
                  className="min-w-0 flex-1 rounded-md border border-[var(--ls-line)] bg-transparent px-2 py-1 text-[12px] text-[var(--ls-text)] outline-none focus:border-[#4e68f5]"
                >
                  <option value="">Select a project file…</option>
                  {projectFiles.map((f) => (
                    <option key={f.id} value={f.id}>{f.path}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Breadcrumbs */}
            <div className="flex flex-wrap items-center gap-0.5 px-5 py-2 text-[12px]">
              {tab === 'upload' && <span className="mr-1 text-[var(--ls-muted)]">Destination:</span>}
              {crumbs.map((c, i) => (
                <span key={`${c.id}-${i}`} className="flex items-center">
                  {i > 0 && <ChevronRight className="h-3 w-3 text-[var(--ls-muted)]" />}
                  <button
                    type="button"
                    data-testid="gdrive-crumb"
                    onClick={() => gotoCrumb(i)}
                    className={`rounded px-1.5 py-0.5 hover:bg-[var(--ls-surface-muted)] ${i === crumbs.length - 1 ? 'font-medium text-[var(--ls-text)]' : 'text-[var(--ls-muted)]'}`}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
            </div>

            {/* Entries */}
            <div className="min-h-[180px] flex-1 overflow-y-auto px-3 pb-2">
              {listLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ls-muted)]"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : listError ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-[var(--ls-muted)]">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  <span>{listError}</span>
                  <button type="button" onClick={() => void loadEntries(folder.id)} className="rounded-md border border-[var(--ls-line-strong)] px-2.5 py-1 text-xs text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]">Retry</button>
                </div>
              ) : entries.length === 0 ? (
                <p className="py-12 text-center text-sm text-[var(--ls-muted)]">This folder is empty.</p>
              ) : (
                <ul className="space-y-0.5">
                  {entries.map((e) => {
                    const target = e.isFolder ? null : importTargetPath(e.name);
                    const importable = tab === 'import' && !e.isFolder && target !== null;
                    return (
                      <li key={e.id} data-testid="gdrive-entry" className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--ls-surface-muted)]">
                        {e.isFolder ? <Folder className="h-4 w-4 flex-none text-[#4e68f5]" /> : isImagePath(e.name) ? <ImageIcon className="h-4 w-4 flex-none text-[var(--ls-muted)]" /> : <Download className="h-4 w-4 flex-none text-[var(--ls-muted)]" />}
                        {e.isFolder ? (
                          <button type="button" onClick={() => openFolder(e)} className="min-w-0 flex-1 truncate text-left text-[13px] text-[var(--ls-text)]">
                            {e.name}
                          </button>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ls-text)]" title={tab === 'import' && !target ? 'Unsupported file type — export as .pdf/.tex first' : e.name}>
                            {e.name}
                            {tab === 'import' && !target && <span className="ml-1.5 text-[11px] text-[var(--ls-muted)]">(unsupported type)</span>}
                          </span>
                        )}
                        <span className="flex-none text-[11px] text-[var(--ls-muted)]">{fmtSize(e.sizeBytes)}</span>
                        {importable && (
                          <button
                            type="button"
                            data-testid="gdrive-import-btn"
                            disabled={busyId === e.id}
                            onClick={() => void doImport(e)}
                            className="flex flex-none items-center gap-1 rounded-md bg-[#4e68f5] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#5f78f8] disabled:opacity-60"
                          >
                            {busyId === e.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />} Import
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-[var(--ls-line)] px-5 py-3">
              {notice && (
                <span className={`min-w-0 truncate text-[12px] ${notice.kind === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500'}`}>{notice.text}</span>
              )}
              {tab === 'upload' && (
                <button
                  type="button"
                  data-testid="gdrive-upload-btn"
                  disabled={!uploadFileId || busyId === 'upload'}
                  onClick={() => void doUpload()}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-[#4e68f5] px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-[#5f78f8] disabled:opacity-50"
                >
                  {busyId === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload to {folder.name}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, id }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; id: string }) {
  return (
    <button
      type="button"
      data-testid={`gdrive-tab-${id}`}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[13px] transition-colors ${
        active ? 'border-[#4e68f5] font-medium text-[var(--ls-text)]' : 'border-transparent text-[var(--ls-muted)] hover:text-[var(--ls-text)]'
      }`}
    >
      {icon} {label}
    </button>
  );
}

/** Shown until Drive is connected — the link, scopes, and construction note. */
function ConnectPanel({ status, onRecheck }: { status: ConnectorStatus | null; onRecheck: () => void }) {
  const needsSetup = status ? status.configured === false : false;
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#4e68f5]/12 text-[#4e68f5]">
        <HardDrive className="h-7 w-7" />
      </div>
      <div className="space-y-1.5">
        <h3 className="text-base font-semibold text-[var(--ls-text)]">Connect Google Drive</h3>
        <p className="mx-auto max-w-sm text-sm text-[var(--ls-muted)]">
          Link your Drive once to import <code className="text-[12px]">.tex</code>/<code className="text-[12px]">.bib</code>/PDFs into this project and upload project files back. Least-privilege scopes only.
        </p>
        {needsSetup && (
          <p className="mx-auto flex max-w-sm items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
            Needs a Google OAuth app first — add the client id/secret on the Connectors page.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/plugins"
          data-testid="gdrive-connect"
          className="flex items-center gap-1.5 rounded-lg bg-[#4e68f5] px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-[#5f78f8]"
        >
          Open Connectors <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          data-testid="gdrive-recheck"
          onClick={onRecheck}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--ls-line-strong)] px-3 py-2 text-[13px] text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Re-check
        </button>
      </div>
      <p className="mx-auto max-w-sm text-[11px] leading-relaxed text-[var(--ls-muted)]">
        Construction build: the OAuth token is exchanged and stored encrypted on your local server — it never reaches the browser. Importing copies the file into the project; uploading sends a copy to Drive.
      </p>
    </div>
  );
}
