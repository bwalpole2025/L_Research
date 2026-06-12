'use client';

/**
 * TEMPLATE OBJECT PALETTE — the click-to-insert catalogue for the maths
 * diagram editor. Entirely data-driven: categories, search, thumbnails and
 * insert all read the registry (lib/diagram/templates/catalog), so adding a
 * template there is the ONLY step to get it here. Thumbnails are the same
 * renderCanvas SVG the canvas uses, scaled to fit a tile.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { TEMPLATES, templateDefaults } from '../../lib/diagram/templates/catalog';
import type { DiagramTemplate, TemplateCtx } from '../../lib/diagram/templates/types';
import type { DiagramScene } from '../../lib/diagram/model';

function Thumb({ t, ctx }: { t: DiagramTemplate; ctx: TemplateCtx }) {
  const p = useMemo(() => templateDefaults(t), [t]);
  const { w, h } = t.size(p, ctx);
  const pad = 8;
  return (
    <svg
      viewBox={`${-w / 2 - pad} ${-h / 2 - pad} ${w + pad * 2} ${h + pad * 2}`}
      className="h-12 w-16 flex-none"
      aria-hidden
      style={{ color: 'var(--ls-text)' }}
    >
      {t.renderCanvas(p, ctx)}
    </svg>
  );
}

const REQ_LABEL: Record<string, string> = { pgfplots: 'pgfplots', 'tikz-3dplot': '3dplot' };

export function TemplatePalette({ scene, onInsert }: { scene: DiagramScene; onInsert: (t: DiagramTemplate) => void }) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const ctx: TemplateCtx = { view3d: scene.view3d, scale: 40 };

  const q = query.trim().toLowerCase();
  const visible = q
    ? TEMPLATES.filter((t) => `${t.name} ${t.description} ${t.category} ${t.id}`.toLowerCase().includes(q))
    : TEMPLATES;
  const byCategory = new Map<string, DiagramTemplate[]>();
  for (const t of visible) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t]);

  return (
    <div className="flex w-60 flex-none flex-col border-r border-[var(--ls-line)] bg-[var(--ls-editor-bg)]" data-testid="dpalette">
      <div className="flex items-center gap-1.5 border-b border-[var(--ls-line)] px-2 py-1.5">
        <Search className="h-3.5 w-3.5 flex-none text-[var(--ls-muted)]" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          data-testid="dpalette-search"
          className="w-full bg-transparent text-[12px] text-[var(--ls-text)] outline-none placeholder:text-[var(--ls-muted)]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {[...byCategory.entries()].map(([cat, items]) => {
          const isClosed = !q && closed[cat];
          return (
            <section key={cat} className="mb-1">
              <button
                type="button"
                onClick={() => setClosed((c) => ({ ...c, [cat]: !c[cat] }))}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]"
              >
                {isClosed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {cat}
                <span className="ml-auto font-normal">{items.length}</span>
              </button>
              {!isClosed &&
                items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    data-testid={`dpalette-item-${t.id}`}
                    title={`${t.description}${t.requiredPackages.length ? `\nNeeds: ${t.requiredPackages.join(', ')} (offered for the preamble on export — never added silently)` : ''}`}
                    onClick={() => onInsert(t)}
                    className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--ls-surface-muted)]"
                  >
                    <Thumb t={t} ctx={ctx} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] text-[var(--ls-text)]">{t.name}</span>
                      <span className="flex flex-wrap gap-1">
                        {t.requiredPackages
                          .filter((r) => !r.startsWith('lib:'))
                          .map((r) => (
                            <span key={r} className="rounded bg-[#4e68f5]/12 px-1 text-[9px] text-[#5b76f7] dark:text-[#8fa3ff]">
                              {REQ_LABEL[r] ?? r}
                            </span>
                          ))}
                      </span>
                    </span>
                  </button>
                ))}
            </section>
          );
        })}
        {visible.length === 0 && <p className="px-1.5 py-2 text-[11px] text-[var(--ls-muted)]">No templates match “{query}”.</p>}
      </div>
    </div>
  );
}
