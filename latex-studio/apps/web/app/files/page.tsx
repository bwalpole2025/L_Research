'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderPlus, Plus, Trash2, RotateCcw, MoveRight, FolderInput, Archive, ArchiveRestore, FolderClosed } from 'lucide-react';
import type { Project, ProjectFolder, TrashItem } from '@latex-studio/shared';
import { api, ApiError } from '@/lib/api';
import { saveLastProject, loadProjectFolderUi, saveProjectFolderUi } from '@/lib/persist';
import { dialog } from '@/lib/dialogStore';
import { AppShell, PageHeader, ShellSearch, TAG_COLORS } from '@/components/AppNav';
import { RequireSession } from '@/components/RequireSession';
import { loadSession } from '@/lib/session';
import { ProjectFolderTree } from '@/components/projects/ProjectFolderTree';
import { Breadcrumb } from '@/components/projects/Breadcrumb';
import { childFolders, descendantIds, folderById, folderPathLabel, readDragPayload, setDragPayload, type DragPayload } from '@/components/projects/folderTree';

/**
 * HOME — a file-explorer for projects. Left: a nestable folder tree (the app-level
 * ProjectFolder hierarchy) plus two special views, Archived and Trash. Right: the
 * selected folder's subfolders + project cards, or the archived/deleted projects.
 *
 * Lifecycle: a project can be ARCHIVED (set aside, hidden from the main list and
 * the editor, fully restorable) or DELETED to Trash (soft-deleted, restorable
 * until purged). Both are reversible; only "Delete forever" in the Trash is not.
 * Moving a project only changes its folderId — its files/paths/compile are
 * untouched.
 */

type View = 'folders' | 'archived' | 'trash';

function FilesIndex() {
  const router = useRouter();

  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const owner = loadSession()?.name ?? 'You';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('folders');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);

  // Archived + Trash buckets, loaded lazily when their view opens.
  const [archived, setArchived] = useState<Project[]>([]);
  const [deleted, setDeleted] = useState<Project[]>([]);
  const [folderTrash, setFolderTrash] = useState<TrashItem[]>([]);
  const [emptyArmed, setEmptyArmed] = useState(false);
  const hydrated = useRef(false);

  const refresh = useCallback(async () => {
    const [ps, fr, tr] = await Promise.all([api.listProjects(), api.listProjectFolders(), api.listProjectTrash()]);
    ps.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    setProjects(ps);
    setFolders(fr.folders);
    setFolderTrash(tr.items);
  }, []);

  const loadArchived = useCallback(() => api.listProjects('archived').then(setArchived).catch(() => undefined), []);
  const loadDeleted = useCallback(() => api.listProjects('deleted').then(setDeleted).catch(() => undefined), []);

  // Initial load + restore persisted explorer state (expanded + selected folder).
  useEffect(() => {
    const ui = loadProjectFolderUi();
    setExpanded(new Set(ui.expanded));
    setSelectedId(ui.selected);
    hydrated.current = true;
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Persist explorer state across reloads.
  useEffect(() => {
    if (!hydrated.current) return;
    saveProjectFolderUi({ expanded: [...expanded], selected: selectedId });
  }, [expanded, selectedId]);

  // If the selected folder vanished (e.g. deleted in another tab), fall back to root.
  useEffect(() => {
    if (selectedId && !loading && !folders.some((f) => f.id === selectedId)) setSelectedId(null);
  }, [folders, selectedId, loading]);

  const flash = (kind: 'error' | 'info', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 5000);
  };
  // Run a mutation, then refresh the active lists AND whichever buckets are in play.
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    try {
      await fn();
      await Promise.all([refresh(), loadArchived(), loadDeleted()]);
      after?.();
    } catch (e) {
      flash('error', e instanceof ApiError ? e.message : 'Something went wrong.');
    }
  };

  // ── View switching ────────────────────────────────────────────────────────
  const openFolders = (id: string | null) => {
    setView('folders');
    setSelectedId(id);
    setQuery('');
  };
  const openArchived = () => {
    setView('archived');
    setQuery('');
    void loadArchived();
  };
  const openTrash = () => {
    setView('trash');
    setQuery('');
    setEmptyArmed(false);
    void loadDeleted();
  };

  // ── Folder operations ───────────────────────────────────────────────────────
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const createFolder = async (parentId: string | null) => {
    const name = (await dialog.prompt({ title: 'New folder', placeholder: 'folder name' }))?.trim();
    if (!name) return;
    void run(
      () => api.createProjectFolder(name, parentId),
      () => {
        if (parentId) setExpanded((p) => new Set(p).add(parentId));
      },
    );
  };
  const renameFolder = (id: string, name: string) => void run(() => api.updateProjectFolder(id, { name }));
  const deleteFolder = async (id: string) => {
    const f = folderById(folders, id);
    const ok = await dialog.confirm({
      title: 'Delete folder',
      message: `Move folder “${f?.name ?? 'folder'}” and its subfolders to trash? Projects inside move to the root.`,
      confirmLabel: 'Move to trash',
      destructive: true,
    });
    if (!ok) return;
    const fallback = f?.parentId ?? null;
    const affected = descendantIds(folders, id);
    void run(
      () => api.deleteProjectFolder(id),
      () => {
        if (selectedId && affected.has(selectedId)) setSelectedId(fallback);
      },
    );
  };

  const onDrop = (payload: DragPayload, targetId: string | null) => {
    if (payload.kind === 'folder') {
      if (payload.id === targetId) return;
      void run(() => api.updateProjectFolder(payload.id, { parentId: targetId }));
    } else {
      void run(() => api.moveProject(payload.id, targetId));
    }
  };

  // ── Project operations ──────────────────────────────────────────────────────
  const createProject = async () => {
    const name = (await dialog.prompt({ title: 'New project', placeholder: 'project name' }))?.trim();
    if (!name) return;
    void api
      .createProject(name, view === 'folders' ? selectedId : null)
      .then((p) => {
        saveLastProject(p.id);
        router.push('/studio');
      })
      .catch((e) => flash('error', e instanceof ApiError ? e.message : 'Could not create project.'));
  };
  const openInStudio = (projectId: string) => {
    saveLastProject(projectId);
    router.push('/studio');
  };
  const moveProject = (projectId: string, folderId: string | null) => {
    setMoveMenuFor(null);
    void run(() => api.moveProject(projectId, folderId));
  };
  const archiveProject = (projectId: string) => void run(() => api.archiveProject(projectId));
  const unarchiveProject = (projectId: string) => void run(() => api.unarchiveProject(projectId));
  const restoreProject = (projectId: string) => void run(() => api.restoreProject(projectId));
  const deleteProject = async (project: Project) => {
    const ok = await dialog.confirm({
      title: 'Move to Trash',
      message: `Move “${project.name}” to the Trash? You can restore it until you empty the Trash.`,
      confirmLabel: 'Move to Trash',
      destructive: true,
    });
    if (ok) void run(() => api.deleteProject(project.id));
  };
  const purgeProject = async (project: Project) => {
    const ok = await dialog.confirm({
      title: 'Delete forever',
      message: `Permanently delete “${project.name}” and all its files? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      destructive: true,
    });
    if (ok) void run(() => api.purgeProject(project.id));
  };
  const emptyTrash = () => {
    if (!emptyArmed) {
      setEmptyArmed(true);
      return;
    }
    setEmptyArmed(false);
    void run(() => Promise.all([api.emptyProjectsTrash(), api.emptyProjectTrash()]));
  };
  const restoreFolderTrash = (id: string) => void run(() => api.restoreProjectTrash(id));

  // ── Derived view ────────────────────────────────────────────────────────────
  const q = query.trim().toLowerCase();
  const searching = view === 'folders' && q.length > 0;
  const subfolders = useMemo(() => childFolders(folders, selectedId), [folders, selectedId]);
  const projectsHere = useMemo(() => projects.filter((p) => (p.folderId ?? null) === selectedId), [projects, selectedId]);
  const searchResults = useMemo(
    () =>
      searching
        ? projects
            .map((p) => ({ project: p, path: folderPathLabel(folders, p.folderId ?? null) }))
            .filter(({ project, path }) => project.name.toLowerCase().includes(q) || project.rootFile.toLowerCase().includes(q) || path.toLowerCase().includes(q))
        : [],
    [searching, projects, folders, q],
  );
  const trashCount = deleted.length + folderTrash.length;
  const currentName = view === 'archived' ? 'Archived' : view === 'trash' ? 'Trash' : selectedId ? folderById(folders, selectedId)?.name ?? 'Folder' : 'All projects';
  const colorFor = (p: Project) => TAG_COLORS[projects.indexOf(p) % TAG_COLORS.length] ?? 'var(--ls-brand)';

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-11 pb-20 pt-12">
        <div className="mb-[26px] flex items-end justify-between gap-6">
          <PageHeader eyebrow={view === 'folders' ? 'Workspace · Projects' : view === 'archived' ? 'Workspace · Set aside' : 'Workspace · Recoverable'} title={currentName} />
        </div>

        {view === 'folders' && (
          <div className="mb-5">
            <ShellSearch value={query} onChange={(e) => setQuery(e.target.value)} data-testid="files-search" placeholder="Search projects across all folders… (⌘K to jump)" />
          </div>
        )}

        {notice && (
          <div
            data-testid="files-notice"
            className={`mb-4 rounded-[10px] border px-4 py-2.5 text-[13px] ${
              notice.kind === 'error'
                ? 'border-[#e05c7e] bg-[rgba(224,92,126,0.10)] text-[#e05c7e]'
                : 'border-[var(--ls-line)] bg-[var(--ls-surface-muted)] text-[var(--ls-text)]'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Stack the folder tree above the content on narrow windows so the
            project list keeps a usable width (no cramped/overlapping names). */}
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-[236px_minmax(0,1fr)]">
          {/* Folder tree + special views */}
          <aside className="rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface)] p-3 lg:max-h-[70vh] lg:overflow-y-auto">
            <ProjectFolderTree
              folders={folders}
              projects={projects}
              selectedId={view === 'folders' ? selectedId : ' none'}
              expanded={expanded}
              onSelect={openFolders}
              onToggle={toggle}
              onCreateFolder={createFolder}
              onRenameFolder={renameFolder}
              onDeleteFolder={deleteFolder}
              onDrop={onDrop}
            />
            <div className="mt-2 space-y-0.5 border-t border-[var(--ls-line)] pt-2">
              <SpecialEntry icon={Archive} label="Archived" count={archived.length} active={view === 'archived'} testid="view-archived" onClick={openArchived} />
              <SpecialEntry icon={Trash2} label="Trash" count={trashCount} active={view === 'trash'} testid="view-trash" onClick={openTrash} />
            </div>
          </aside>

          {/* Content */}
          <section className="min-w-0">
            {view === 'archived' ? (
              <ArchivedView projects={archived} loading={loading} onOpen={openInStudio} onUnarchive={unarchiveProject} onDelete={deleteProject} />
            ) : view === 'trash' ? (
              <TrashView
                projects={deleted}
                folders={folderTrash}
                emptyArmed={emptyArmed}
                onRestore={restoreProject}
                onPurge={purgeProject}
                onRestoreFolder={restoreFolderTrash}
                onEmpty={emptyTrash}
              />
            ) : (
              <>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <Breadcrumb folders={folders} selectedId={selectedId} onSelect={openFolders} onDrop={onDrop} />
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void createFolder(selectedId)}
                      className="inline-flex items-center gap-1.5 rounded-[9px] border border-[var(--ls-line)] px-3 py-1.5 text-[13px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
                    >
                      <FolderPlus className="h-3.5 w-3.5" /> New folder
                    </button>
                    <button
                      type="button"
                      data-testid="new-project-here"
                      onClick={() => void createProject()}
                      className="inline-flex items-center gap-1.5 rounded-[9px] bg-[var(--ls-brand)] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5" /> New project
                    </button>
                  </div>
                </div>

                {searching ? (
                  <SearchResults results={searchResults} owner={owner} onOpen={openInStudio} />
                ) : (
                  <>
                    {subfolders.length > 0 && (
                      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
                        {subfolders.map((f) => (
                          <FolderCard
                            key={f.id}
                            folder={f}
                            count={projects.filter((p) => p.folderId === f.id).length}
                            onOpen={() => openFolders(f.id)}
                            onDrop={onDrop}
                          />
                        ))}
                      </div>
                    )}

                    <div className="overflow-visible rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface)]">
                      {projectsHere.map((project) => (
                        <ProjectRow
                          key={project.id}
                          project={project}
                          owner={owner}
                          color={colorFor(project)}
                          folders={folders}
                          menuOpen={moveMenuFor === project.id}
                          onToggleMenu={() => setMoveMenuFor((cur) => (cur === project.id ? null : project.id))}
                          onMove={(folderId) => moveProject(project.id, folderId)}
                          onOpen={() => openInStudio(project.id)}
                          onArchive={() => archiveProject(project.id)}
                          onDelete={() => void deleteProject(project)}
                        />
                      ))}
                      {!loading && projectsHere.length === 0 && subfolders.length === 0 && (
                        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                          <FolderInput className="h-8 w-8 text-[var(--ls-muted)]" />
                          <p className="text-[14px] text-[var(--ls-muted)]">No projects here yet — create one.</p>
                          <button
                            type="button"
                            onClick={() => void createProject()}
                            className="inline-flex items-center gap-1.5 rounded-[9px] bg-[var(--ls-brand)] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:opacity-90"
                          >
                            <Plus className="h-3.5 w-3.5" /> New project
                          </button>
                        </div>
                      )}
                      {!loading && projectsHere.length === 0 && subfolders.length > 0 && (
                        <div className="px-6 py-8 text-center text-[13px] text-[var(--ls-muted)]">No projects directly in this folder.</div>
                      )}
                    </div>
                  </>
                )}

                <p className="mt-6 text-center text-[13px] text-[var(--ls-muted)]">
                  {loading ? 'Loading…' : <>{projects.length} project{projects.length === 1 ? '' : 's'} · {folders.length} folder{folders.length === 1 ? '' : 's'}</>}
                </p>
              </>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SpecialEntry({ icon: Icon, label, count, active, testid, onClick }: { icon: typeof Archive; label: string; count: number; active: boolean; testid: string; onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[13px] transition-colors ${
        active ? 'bg-[var(--ls-brand-soft)] text-[var(--ls-text)]' : 'text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]'
      }`}
    >
      <Icon className="h-4 w-4 flex-none" />
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && <span className="flex-none rounded-full bg-[var(--ls-surface-muted)] px-1.5 text-[11px] tabular-nums text-[var(--ls-muted)]">{count}</span>}
    </button>
  );
}

function FolderCard({ folder, count, onOpen, onDrop }: { folder: ProjectFolder; count: number; onOpen: () => void; onDrop: (p: DragPayload, t: string | null) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      data-testid="folder-card"
      draggable
      onDragStart={(e) => setDragPayload(e, { kind: 'folder', id: folder.id })}
      onClick={onOpen}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const payload = readDragPayload(e);
        if (payload) onDrop(payload, folder.id);
      }}
      className={`flex items-center gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
        over ? 'border-[var(--ls-brand)] bg-[var(--ls-brand-soft)]' : 'border-[var(--ls-line)] bg-[var(--ls-surface)] hover:bg-[var(--ls-surface-muted)]'
      }`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="flex-none text-[var(--ls-brand)]">
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
          {folder.name}
        </span>
        <span className="text-[12px] text-[var(--ls-muted)]">{count} project{count === 1 ? '' : 's'}</span>
      </span>
    </button>
  );
}

/** Last compile outcome at a glance (the workspace badge slot). */
function CompileBadge({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<'success' | 'error' | 'timeout' | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api.getCompileStatus(projectId).then((r) => {
      if (!cancelled) setStatus(r.status);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  if (!status) return null;
  const ok = status === 'success';
  return (
    <span
      data-testid="compile-badge"
      data-status={status}
      title={ok ? 'Last compile succeeded' : 'Last compile failed'}
      className={`inline-flex flex-none items-center gap-1 rounded-[7px] border px-1.5 py-0.5 text-[10.5px] font-medium ${
        ok
          ? 'border-emerald-300 text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400'
          : 'border-red-300 text-red-600 dark:border-red-500/40 dark:text-red-400'
      }`}
    >
      <span className={`h-[6px] w-[6px] rounded-full ${ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
      {ok ? 'Compiled' : 'Failed'}
    </span>
  );
}

function IconAction({ icon: Icon, label, onClick, danger }: { icon: typeof Archive; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-lg border p-1.5 transition-colors ${
        danger
          ? 'border-[var(--ls-line)] text-[var(--ls-muted)] hover:border-[#e05c7e] hover:bg-[rgba(224,92,126,0.10)] hover:text-[#e05c7e]'
          : 'border-[var(--ls-line)] text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function ProjectRow({
  project,
  owner,
  color,
  folders,
  menuOpen,
  onToggleMenu,
  onMove,
  onOpen,
  onArchive,
  onDelete,
}: {
  project: Project;
  owner: string;
  color: string;
  folders: ProjectFolder[];
  menuOpen: boolean;
  onToggleMenu: () => void;
  onMove: (folderId: string | null) => void;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div data-testid="files-project" className="relative border-b border-[var(--ls-line)] last:border-0">
      <div
        draggable
        onDragStart={(e) => setDragPayload(e, { kind: 'project', id: project.id })}
        onClick={onOpen}
        className="flex cursor-pointer items-center gap-3 px-5 py-[15px] transition-colors hover:bg-[var(--ls-surface-muted)]"
      >
        {/* Name + root-file pill: both shrink/truncate so they never overflow into
            the owner/actions, even when the project list is narrow. */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          <span className="min-w-0 shrink truncate text-[15px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
            {project.name}
          </span>
          <span className="inline-flex min-w-0 shrink items-center gap-[7px] overflow-hidden rounded-[7px] border border-[var(--ls-line)] bg-[var(--ls-surface-muted)] py-1 pl-[9px] pr-2.5">
            <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: color }} />
            <span className="truncate text-[12.5px] text-[var(--ls-muted)]">{project.rootFile}</span>
          </span>
          <CompileBadge projectId={project.id} />
        </div>
        {/* Owner is secondary — hide it when there isn't room (narrow windows). */}
        <span className="hidden w-[130px] flex-none truncate text-[13.5px] text-[var(--ls-muted)] lg:block">{owner}</span>
        <div className="flex flex-none items-center justify-end gap-1.5">
          <IconAction icon={MoveRight} label="Move to folder" onClick={onToggleMenu} />
          <IconAction icon={Archive} label="Archive" onClick={onArchive} />
          <IconAction icon={Trash2} label="Move to Trash" onClick={onDelete} danger />
          <button
            type="button"
            data-testid="files-open-studio"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="rounded-lg border border-[var(--ls-line)] px-2.5 py-1.5 text-xs text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
          >
            Open in Studio
          </button>
        </div>
      </div>

      {menuOpen && (
        <MoveToMenu folders={folders} currentFolderId={project.folderId ?? null} onPick={onMove} onClose={onToggleMenu} />
      )}
    </div>
  );
}

function MoveToMenu({
  folders,
  currentFolderId,
  onPick,
  onClose,
}: {
  folders: ProjectFolder[];
  currentFolderId: string | null;
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const options: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'All projects (root)' },
    ...folders.map((f) => ({ id: f.id, label: folderPathLabel(folders, f.id) })).sort((a, b) => a.label.localeCompare(b.label)),
  ];
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-5 top-[52px] z-20 max-h-[300px] w-[260px] overflow-y-auto rounded-[10px] border border-[var(--ls-line)] bg-[var(--ls-surface-raised)] py-1 shadow-[var(--ls-shadow-soft)]">
        <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-muted)]">Move to…</div>
        {options.map((o) => (
          <button
            key={o.id ?? 'root'}
            type="button"
            disabled={o.id === currentFolderId}
            onClick={() => onPick(o.id)}
            className={`block w-full truncate px-3 py-1.5 text-left text-[13px] transition-colors ${
              o.id === currentFolderId ? 'cursor-default text-[var(--ls-muted)]' : 'text-[var(--ls-text)] hover:bg-[var(--ls-brand-soft)]'
            }`}
          >
            {o.label}
            {o.id === currentFolderId && ' ·  here'}
          </button>
        ))}
      </div>
    </>
  );
}

function SearchResults({ results, owner: _owner, onOpen }: { results: Array<{ project: Project; path: string }>; owner: string; onOpen: (id: string) => void }) {
  if (results.length === 0) return <div className="rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface)] px-6 py-10 text-center text-[13px] text-[var(--ls-muted)]">No projects match this search.</div>;
  return (
    <div className="overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface)]">
      {results.map(({ project, path }) => (
        <button
          key={project.id}
          type="button"
          data-testid="files-project"
          onClick={() => onOpen(project.id)}
          className="flex w-full items-center justify-between gap-4 border-b border-[var(--ls-line)] px-5 py-[15px] text-left transition-colors last:border-0 hover:bg-[var(--ls-surface-muted)]"
        >
          <span className="min-w-0 truncate text-[15px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
            {project.name}
          </span>
          <span className="flex-none truncate text-[12.5px] text-[var(--ls-muted)]">{path}</span>
        </button>
      ))}
    </div>
  );
}

/** Archived projects — set aside, hidden from the main list + editor, restorable. */
function ArchivedView({ projects, loading, onOpen, onUnarchive, onDelete }: { projects: Project[]; loading: boolean; onOpen: (id: string) => void; onUnarchive: (id: string) => void; onDelete: (p: Project) => void }) {
  return (
    <div data-testid="archived-view">
      <p className="mb-4 text-[13px] text-[var(--ls-muted)]">Archived projects are kept out of your main list and the Studio switcher. Restore one any time, or send it to the Trash.</p>
      <div className="overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface)]">
        {projects.map((project) => (
          <div key={project.id} data-testid="archived-project" className="flex items-center gap-3 border-b border-[var(--ls-line)] px-5 py-[15px] last:border-0">
            <button type="button" onClick={() => onOpen(project.id)} className="min-w-0 flex-1 truncate text-left text-[15px] font-medium text-[var(--ls-text)] hover:underline" style={{ fontFamily: 'var(--ls-serif)' }}>
              {project.name}
            </button>
            <span className="hidden flex-none text-[12.5px] text-[var(--ls-muted)] sm:block">{project.rootFile}</span>
            <div className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                data-testid="unarchive-project"
                onClick={() => onUnarchive(project.id)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--ls-line)] px-2.5 py-1 text-[12.5px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
              >
                <ArchiveRestore className="h-3.5 w-3.5" /> Restore
              </button>
              <IconAction icon={Trash2} label="Move to Trash" onClick={() => onDelete(project)} danger />
            </div>
          </div>
        ))}
        {!loading && projects.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Archive className="h-8 w-8 text-[var(--ls-muted)]" />
            <p className="text-[14px] text-[var(--ls-muted)]">No archived projects.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Trash — soft-deleted projects + deleted folders, restorable until purged. */
function TrashView({
  projects,
  folders,
  emptyArmed,
  onRestore,
  onPurge,
  onRestoreFolder,
  onEmpty,
}: {
  projects: Project[];
  folders: TrashItem[];
  emptyArmed: boolean;
  onRestore: (id: string) => void;
  onPurge: (p: Project) => void;
  onRestoreFolder: (id: string) => void;
  onEmpty: () => void;
}) {
  const empty = projects.length === 0 && folders.length === 0;
  return (
    <div data-testid="trash-view">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[13px] text-[var(--ls-muted)]">Deleted projects and folders live here. Restore them, or empty the Trash to delete permanently.</p>
        {!empty && (
          <button
            type="button"
            data-testid="empty-trash"
            onClick={onEmpty}
            className={`flex-none rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              emptyArmed ? 'bg-[#e05c7e] text-white' : 'border border-[#e05c7e] text-[#e05c7e] hover:bg-[rgba(224,92,126,0.10)]'
            }`}
          >
            {emptyArmed ? 'Click again — permanent' : 'Empty Trash'}
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface)]">
        {projects.map((project) => (
          <div key={project.id} data-testid="trash-project" className="flex items-center gap-3 border-b border-[var(--ls-line)] px-5 py-[15px] last:border-0">
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
              {project.name}
            </span>
            <div className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                data-testid="restore-project"
                onClick={() => onRestore(project.id)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--ls-line)] px-2.5 py-1 text-[12.5px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
              <button
                type="button"
                data-testid="purge-project"
                onClick={() => onPurge(project)}
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e05c7e] px-2.5 py-1 text-[12.5px] text-[#e05c7e] transition-colors hover:bg-[rgba(224,92,126,0.10)]"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete forever
              </button>
            </div>
          </div>
        ))}
        {folders.map((it) => (
          <div key={it.id} data-testid="trash-folder" className="flex items-center gap-3 border-b border-[var(--ls-line)] px-5 py-[15px] last:border-0">
            <FolderClosed className="h-4 w-4 flex-none text-[var(--ls-muted)]" />
            <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--ls-text)]">{it.label}</span>
            <button
              type="button"
              onClick={() => onRestoreFolder(it.id)}
              className="inline-flex flex-none items-center gap-1.5 rounded-[8px] border border-[var(--ls-line)] px-2.5 py-1 text-[12.5px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Restore
            </button>
          </div>
        ))}
        {empty && (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <Trash2 className="h-8 w-8 text-[var(--ls-muted)]" />
            <p className="text-[14px] text-[var(--ls-muted)]">Trash is empty.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FilesPage() {
  return (
    <RequireSession>
      <Suspense>
        <FilesIndex />
      </Suspense>
    </RequireSession>
  );
}
