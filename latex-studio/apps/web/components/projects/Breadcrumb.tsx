'use client';

import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ProjectFolder } from '@latex-studio/shared';
import { folderPath, readDragPayload, type DragPayload } from './folderTree';

/**
 * "Root ▸ Ferrofluid ▸ Plateau border" path for the selected folder. Each crumb is
 * clickable (navigate) and a drop target (drop a project/folder to move it there).
 */
export function Breadcrumb({
  folders,
  selectedId,
  onSelect,
  onDrop,
}: {
  folders: ProjectFolder[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDrop: (payload: DragPayload, targetId: string | null) => void;
}) {
  const path = folderPath(folders, selectedId);
  const [hover, setHover] = useState<string | null | 'none'>('none');

  const crumb = (id: string | null, label: string) => (
    <button
      type="button"
      onClick={() => onSelect(id)}
      onDragOver={(e) => {
        e.preventDefault();
        setHover(id);
      }}
      onDragLeave={() => setHover('none')}
      onDrop={(e) => {
        e.preventDefault();
        setHover('none');
        const payload = readDragPayload(e);
        if (payload) onDrop(payload, id);
      }}
      className={`max-w-[220px] truncate rounded-[7px] px-2 py-1 transition-colors ${
        hover === id
          ? 'bg-[var(--ls-brand-soft)] text-[var(--ls-text)]'
          : id === selectedId
            ? 'font-medium text-[var(--ls-text)]'
            : 'text-[var(--ls-muted)] hover:text-[var(--ls-text)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <nav className="flex items-center gap-0.5 text-[13px]" aria-label="Breadcrumb">
      {crumb(null, 'All projects')}
      {path.map((f) => (
        <Fragment key={f.id}>
          <ChevronRight className="h-3.5 w-3.5 flex-none text-[var(--ls-muted)]" />
          {crumb(f.id, f.name)}
        </Fragment>
      ))}
    </nav>
  );
}
