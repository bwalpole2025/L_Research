'use client';

/**
 * PREDICTIVE CODING IN THE VISUAL EDITOR — the deterministic LaTeX autocomplete
 * (commands incl. the project's own macros, \cite keys, \ref labels,
 * \begin/\end environments), driven by the SAME pure context detector, data
 * sources, settings toggles and adaptive usage ranking as the Code view.
 * Offline and instant: no model call is ever made from this module.
 *
 * Coexistence: while the dropdown is open it owns Tab/Enter/Esc and the AI
 * ghost stays hidden (visualGhost checks `visualAcOpen()`); when it closes the
 * ghost resumes — the same precedence as the Code view.
 */

import { useEffect, type RefObject } from 'react';
import { detectAcContext, type AcContext } from './latexAutocomplete';
import { COMMANDS, ENVIRONMENTS, PACKAGE_COMMANDS } from './latexData';
import { indexedBib, indexedCustomEnvs, indexedLabels, indexedMacros, indexedPackages, refreshIndexInBackground } from '../../lib/latexIndex';
import { useAutocompleteStore } from '../../lib/autocompleteStore';
import { recordAccept, usageBoost, type UsageCategory } from '../../lib/usage';
import { latexAroundCaret } from './visualGhost';

export interface VisualAcOption {
  label: string;
  detail: string;
  /** Replaces the typed query (which spans `queryLen` chars before the caret). */
  insert: string;
  /** Caret position within `insert` after accepting (default: at its end). */
  caret?: number;
  usage?: { category: UsageCategory; name: string };
}

/** `frac{${}}{${}}` → `frac{}{}` — contentEditable has no tab stops. */
export function stripPlaceholders(snippet: string): string {
  return snippet.replace(/\$\{[^}]*\}/g, '');
}

/** Caret lands inside the first empty `{}` pair, else at the end. */
export function caretAfterInsert(insert: string): number {
  const brace = insert.indexOf('{}');
  return brace >= 0 ? brace + 1 : insert.length;
}

/** Candidate options for one detected context (unfiltered). */
export function acOptions(ctx: AcContext): VisualAcOption[] {
  const { sources } = useAutocompleteStore.getState();
  switch (ctx.kind) {
    case 'command': {
      if (!sources.commands) return [];
      const out: VisualAcOption[] = [];
      const seen = new Set<string>();
      for (const m of indexedMacros()) {
        if (seen.has(m.name)) continue;
        seen.add(m.name);
        out.push({ label: `\\${m.name}`, detail: 'macro (this project)', insert: `\\${m.name}`, usage: { category: 'cmd', name: m.name } });
      }
      const loaded = new Set(indexedPackages());
      for (const [pkg, cmds] of Object.entries(PACKAGE_COMMANDS)) {
        if (!loaded.has(pkg)) continue;
        for (const c of cmds) {
          if (seen.has(c.name)) continue;
          seen.add(c.name);
          const insert = `\\${stripPlaceholders(c.snippet ?? c.name)}`;
          out.push({ label: `\\${c.name}`, detail: c.detail, insert, caret: caretAfterInsert(insert), usage: { category: 'cmd', name: c.name } });
        }
      }
      for (const c of COMMANDS) {
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        const insert = `\\${stripPlaceholders(c.snippet ?? c.name)}`;
        out.push({ label: `\\${c.name}`, detail: c.detail, insert, caret: caretAfterInsert(insert), usage: { category: 'cmd', name: c.name } });
      }
      return out;
    }
    case 'cite': {
      if (!sources.citations) return [];
      return indexedBib().map((e) => ({
        label: e.key,
        detail: [e.author?.split(/\s+and\s+/i)[0], e.year].filter(Boolean).join(', '),
        insert: `${e.key}}`,
        usage: { category: 'cite', name: e.key },
      }));
    }
    case 'ref': {
      if (!sources.labels) return [];
      return indexedLabels().map((l) => ({
        label: l.name,
        detail: l.context.slice(0, 40),
        insert: `${l.name}}`,
        usage: { category: 'label', name: l.name },
      }));
    }
    case 'begin': {
      if (!sources.environments) return [];
      const custom = indexedCustomEnvs().map((name) => ({ name, detail: 'environment (this project)' }));
      return [...custom, ...ENVIRONMENTS].map((e) => {
        const insert = `${e.name}} \\end{${e.name}}`;
        return { label: e.name, detail: e.detail, insert, caret: `${e.name}} `.length, usage: { category: 'env', name: e.name } as const };
      });
    }
    case 'end': {
      if (!sources.environments) return [];
      return [...indexedCustomEnvs().map((n) => ({ name: n, detail: 'environment (this project)' })), ...ENVIRONMENTS].map((e) => ({
        label: e.name,
        detail: e.detail,
        insert: `${e.name}}`,
        usage: { category: 'env', name: e.name },
      }));
    }
    default:
      return []; // graphics/input/usepackage/documentclass/label: Code-view territory
  }
}

/** Prefix matches first, then substring; within a tier the adaptive usage score
 *  orders (same rule as the Code view: popularity never surfaces a non-match). */
export function filterAndRank(options: VisualAcOption[], query: string, max = 50): VisualAcOption[] {
  const q = query.toLowerCase();
  const scored = options
    .map((o) => {
      const label = o.label.replace(/^\\/, '').toLowerCase();
      const tier = !q ? 1 : label.startsWith(q) ? 2 : label.includes(q) ? 1 : 0;
      return { o, tier, boost: o.usage ? usageBoost(o.usage.category, o.usage.name) : 0 };
    })
    .filter((s) => s.tier > 0);
  scored.sort((a, b) => b.tier - a.tier || b.boost - a.boost || a.o.label.localeCompare(b.o.label));
  return scored.slice(0, max).map((s) => s.o);
}

// ── The dropdown (vanilla DOM, themed via CSS variables) ─────────────────────

let openDropdown: HTMLElement | null = null;

/** True while a Visual autocomplete dropdown is open (ghost suppression). */
export function visualAcOpen(): boolean {
  return openDropdown !== null;
}

function closeDropdown(): void {
  openDropdown?.remove();
  openDropdown = null;
}

interface ActiveState {
  options: VisualAcOption[];
  selected: number;
  queryLen: number;
}

/** Render the dropdown at a fixed screen position (shared by both adapters). */
function renderDropdownAt(
  pos: { left: number; top: number },
  state: ActiveState | null,
  accept: (o: VisualAcOption) => void,
): void {
  closeDropdown();
  if (!state || state.options.length === 0) return;
  const box = document.createElement('div');
  box.className = 'vv-ac';
  box.setAttribute('data-testid', 'vv-ac');
  Object.assign(box.style, {
    position: 'fixed',
    left: `${Math.min(pos.left, window.innerWidth - 340)}px`,
    top: `${pos.top}px`,
    zIndex: '60',
    minWidth: '240px',
    maxWidth: '330px',
    maxHeight: '264px',
    overflowY: 'auto',
    background: 'var(--ls-surface)',
    border: '1px solid var(--ls-line-strong)',
    borderRadius: '9px',
    boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
    fontSize: '13px',
    padding: '3px',
  } as Partial<CSSStyleDeclaration>);
  state.options.slice(0, 12).forEach((o, i) => {
    const row = document.createElement('div');
    row.className = 'vv-ac-item';
    Object.assign(row.style, {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '14px',
      padding: '4px 9px',
      borderRadius: '6px',
      cursor: 'pointer',
      background: i === state.selected ? 'var(--ls-brand-soft)' : 'transparent',
    } as Partial<CSSStyleDeclaration>);
    const label = document.createElement('span');
    label.textContent = o.label;
    label.style.fontFamily = 'var(--ls-mono, monospace)';
    const detail = document.createElement('span');
    detail.textContent = o.detail;
    Object.assign(detail.style, { color: 'var(--ls-muted)', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '170px' } as Partial<CSSStyleDeclaration>);
    row.append(label, detail);
    row.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep focus in the field
      accept(o);
    });
    box.appendChild(row);
  });
  document.body.appendChild(box);
  openDropdown = box;
}

export function useVisualAutocomplete(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let state: ActiveState | null = null;

    const close = () => {
      state = null;
      closeDropdown();
    };

    const render = () => {
      closeDropdown();
      if (!state || state.options.length === 0) {
        state = null;
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const box = document.createElement('div');
      box.className = 'vv-ac';
      box.setAttribute('data-testid', 'vv-ac');
      Object.assign(box.style, {
        position: 'fixed',
        left: `${Math.min(rect.left, window.innerWidth - 340)}px`,
        top: `${rect.bottom + 4}px`,
        zIndex: '60',
        minWidth: '240px',
        maxWidth: '330px',
        maxHeight: '264px',
        overflowY: 'auto',
        background: 'var(--ls-surface)',
        border: '1px solid var(--ls-line-strong)',
        borderRadius: '9px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        fontSize: '13px',
        padding: '3px',
      } as Partial<CSSStyleDeclaration>);
      state.options.slice(0, 12).forEach((o, i) => {
        const row = document.createElement('div');
        row.className = 'vv-ac-item';
        Object.assign(row.style, {
          display: 'flex',
          justifyContent: 'space-between',
          gap: '14px',
          padding: '4px 9px',
          borderRadius: '6px',
          cursor: 'pointer',
          background: i === state!.selected ? 'var(--ls-brand-soft)' : 'transparent',
        } as Partial<CSSStyleDeclaration>);
        const label = document.createElement('span');
        label.textContent = o.label;
        label.style.fontFamily = 'var(--ls-mono, monospace)';
        const detail = document.createElement('span');
        detail.textContent = o.detail;
        Object.assign(detail.style, { color: 'var(--ls-muted)', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '170px' } as Partial<CSSStyleDeclaration>);
        row.append(label, detail);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep the caret in the editable
          accept(o);
        });
        box.appendChild(row);
      });
      document.body.appendChild(box);
      openDropdown = box;
    };

    /** Replace the typed query before the caret with the accepted insert. */
    const accept = (o: VisualAcOption) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !state) return close();
      const caret = sel.getRangeAt(0);
      if (!caret.collapsed || !el.contains(caret.startContainer)) return close();

      // Walk backwards across text nodes to cover `queryLen` characters.
      let node = caret.startContainer;
      let offset = caret.startOffset;
      let remaining = state.queryLen;
      const range = document.createRange();
      range.setEnd(node, offset);
      while (remaining > 0) {
        if (node.nodeType === Node.TEXT_NODE && offset > 0) {
          const take = Math.min(offset, remaining);
          offset -= take;
          remaining -= take;
        } else {
          // step to the previous text node within the block
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let prev: Node | null = null;
          let cur: Node | null = walker.nextNode();
          while (cur && cur !== node) {
            prev = cur;
            cur = walker.nextNode();
          }
          if (!prev) break;
          node = prev;
          offset = prev.textContent?.length ?? 0;
        }
      }
      range.setStart(node, offset);
      range.deleteContents();

      const text = document.createTextNode(o.insert);
      range.insertNode(text);
      const nr = document.createRange();
      nr.setStart(text, Math.min(o.caret ?? o.insert.length, o.insert.length));
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);

      if (o.usage) recordAccept(o.usage.category, o.usage.name); // adaptive ranking learns here too
      close();
    };

    const onInput = (e: Event) => {
      if ((e.target as HTMLElement).closest?.('input')) return; // chip editor
      const { enabled } = useAutocompleteStore.getState();
      if (!enabled) return close();
      refreshIndexInBackground();
      const split = latexAroundCaret(el);
      if (!split) return close();
      const ctx: AcContext | null = detectAcContext(split.before, 0);
      if (!ctx) return close();
      const queryLen = split.before.length - ctx.from;
      const options = filterAndRank(acOptions(ctx), ctx.query);
      if (options.length === 0) return close();
      // The dropdown owns the screen: any visible ghost yields.
      el.querySelectorAll('[data-ghost]').forEach((g) => g.remove());
      state = { options, selected: 0, queryLen };
      render();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!state) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        state.selected = (state.selected + (e.key === 'ArrowDown' ? 1 : -1) + Math.min(state.options.length, 12)) % Math.min(state.options.length, 12);
        render();
      } else if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation(); // the ghost's Tab handler must not also fire
        accept(state.options[state.selected]!);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
    };

    const onBlur = () => close();

    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown, true); // capture: precede the ghost's handler
    el.addEventListener('blur', onBlur);
    return () => {
      close();
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeyDown, true);
      el.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ── The same predictive coding for plain text fields (the equation editor's
//    textarea and the inline chip input) ─────────────────────────────────────

/** Attach the LaTeX dropdown to a textarea/input. Returns a dispose function.
 *  Works with React-controlled fields: accepted text is written through the
 *  native value setter and re-announced via an `input` event. */
export function attachTextFieldAutocomplete(field: HTMLTextAreaElement | HTMLInputElement): () => void {
  let state: ActiveState | null = null;

  const close = () => {
    state = null;
    closeDropdown();
  };

  const setValue = (next: string, caret: number) => {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(field, next);
    field.setSelectionRange(caret, caret);
    field.dispatchEvent(new Event('input', { bubbles: true })); // React onChange
  };

  const accept = (o: VisualAcOption) => {
    if (!state) return close();
    const pos = field.selectionStart ?? 0;
    const start = pos - state.queryLen;
    const next = field.value.slice(0, start) + o.insert + field.value.slice(pos);
    close(); // close BEFORE the input event re-triggers detection
    setValue(next, start + Math.min(o.caret ?? o.insert.length, o.insert.length));
  };

  const render = () => {
    const rect = field.getBoundingClientRect();
    renderDropdownAt({ left: rect.left + 8, top: rect.bottom + 2 }, state, accept);
  };

  const onInput = () => {
    const { enabled } = useAutocompleteStore.getState();
    if (!enabled) return close();
    refreshIndexInBackground();
    const pos = field.selectionStart ?? 0;
    const before = field.value.slice(0, pos);
    const ctx = detectAcContext(before, 0);
    if (!ctx) return close();
    const options = filterAndRank(acOptions(ctx), ctx.query);
    if (options.length === 0) return close();
    state = { options, selected: 0, queryLen: before.length - ctx.from };
    render();
  };

  const onKeyDown = (ev: Event) => {
    const e = ev as KeyboardEvent;
    if (!state) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = Math.min(state.options.length, 12);
      state.selected = (state.selected + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      render();
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      accept(state.options[state.selected]!);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation(); // first Esc closes the dropdown, not the editor
      close();
    }
  };

  const onBlur = () => close();

  field.addEventListener('input', onInput);
  field.addEventListener('keydown', onKeyDown, true);
  field.addEventListener('blur', onBlur);
  return () => {
    close();
    field.removeEventListener('input', onInput);
    field.removeEventListener('keydown', onKeyDown, true);
    field.removeEventListener('blur', onBlur);
  };
}

/** Hook form for React-managed fields (the equation editor textarea). */
export function useTextFieldAutocomplete(ref: RefObject<HTMLTextAreaElement | null>, active: boolean): void {
  useEffect(() => {
    const field = ref.current;
    if (!active || !field) return;
    return attachTextFieldAutocomplete(field);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
