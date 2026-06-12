'use client';

/**
 * AI GHOST COMPLETIONS IN THE VISUAL EDITOR — the same predictive engine as the
 * Code view (same scheduler, same /complete endpoint, same approval rule: the
 * model only ever PROPOSES; nothing reaches the document without an explicit
 * Tab), adapted to contentEditable blocks:
 *
 *  · typing schedules a debounced request with the FULL document context
 *    (LaTeX before/after the caret, chips serialised verbatim);
 *  · the suggestion renders as a dimmed, non-editable ghost span at the caret;
 *  · Tab accepts (inserts real text, which write-back commits as usual),
 *    Escape rejects, any edit or blur clears.
 */

import { useEffect, type RefObject } from 'react';
import { completeCode } from '../../lib/api';
import { CompletionScheduler } from '../../lib/completion/scheduler';
import { detectMode } from '../../lib/completion/mode';
import type { CompletionRequestContext } from '../../lib/completion/types';
import { useCompletionStore } from '../../lib/completionStore';
import { useEditorStore } from '../../lib/store';

const PREFIX_CHARS = 8000;
const SUFFIX_CHARS = 2000;

/** The block's LaTeX split at the caret — the contentEditable mirror of the
 *  Code view's prefix/suffix. Chips contribute their data-tex verbatim; a
 *  wrapper open brace lands on the side where it begins and its close on the
 *  side where it ends; the ghost itself is never counted. Returns null when
 *  there is no collapsed caret inside `root` (or it sits in a chip input). */
export function latexAroundCaret(root: HTMLElement, sel: Selection | null = typeof window === 'undefined' ? null : window.getSelection()): { before: string; after: string } | null {
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return null;
  if ((range.startContainer as HTMLElement).nodeType === Node.ELEMENT_NODE && (range.startContainer as HTMLElement).closest('input')) return null;

  let before = '';
  let after = '';
  let passed = false;
  const emit = (s: string) => {
    if (passed) after += s;
    else before += s;
  };

  const handle = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      if (node === range.startContainer) {
        before += t.slice(0, range.startOffset);
        passed = true;
        after += t.slice(range.startOffset);
      } else {
        emit(t);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.hasAttribute('data-ghost')) return; // the suggestion is not document text
    const tex = el.getAttribute('data-tex');
    if (tex !== null) {
      emit(tex); // atomic chip — verbatim, never descended
      return;
    }
    if (el.tagName === 'BR') {
      emit(' ');
      return;
    }
    const wrap = el.getAttribute('data-wrap');
    if (wrap) emit(`\\${wrap}{`);
    visitChildren(el);
    if (wrap) emit('}');
  };

  const visitChildren = (el: Node): void => {
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      if (el === range.startContainer && i === range.startOffset) passed = true;
      handle(kids[i]!);
    }
    if (el === range.startContainer && kids.length === range.startOffset) passed = true;
  };

  visitChildren(root);
  return { before, after };
}

export interface DocContext {
  /** Document LaTeX before this block (ends with a newline). */
  before: string;
  /** Document LaTeX after this block (starts with a newline). */
  after: string;
}

function buildCtx(el: HTMLElement, getDocContext: () => DocContext): CompletionRequestContext | null {
  const split = latexAroundCaret(el);
  if (!split) return null;
  const doc = getDocContext();
  const prefixFull = `${doc.before}${split.before}`;
  const suffixFull = `${split.after}${doc.after}`;
  const info = detectMode(prefixFull + suffixFull, prefixFull.length);
  return {
    prefix: prefixFull.slice(-PREFIX_CHARS),
    suffix: suffixFull.slice(0, SUFFIX_CHARS),
    pos: prefixFull.length,
    mode: info.mode,
    inComment: info.inComment,
    midWord: info.midWord,
  };
}

/** Ghost-text lifecycle for one editable Visual block. */
export function useVisualGhost(ref: RefObject<HTMLElement | null>, getDocContext: () => DocContext): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let disposed = false;

    const clearGhost = () => el.querySelectorAll('[data-ghost]').forEach((g) => g.remove());

    const showGhost = (text: string) => {
      clearGhost();
      if (document.querySelector('.vv-ac')) return; // the dropdown owns the screen
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!range.collapsed || !el.contains(range.startContainer)) return;
      const ghost = document.createElement('span');
      ghost.setAttribute('data-ghost', '');
      ghost.setAttribute('contenteditable', 'false');
      ghost.className = 'vv-ghost';
      ghost.textContent = text;
      range.cloneRange().insertNode(ghost);
      // The caret stays BEFORE the ghost so typing continues naturally.
      const nr = document.createRange();
      nr.setStartBefore(ghost);
      nr.collapse(true);
      sel.removeAllRanges();
      sel.addRange(nr);
    };

    const scheduler = new CompletionScheduler({
      fetch: (req, signal) => {
        const pid = useEditorStore.getState().projectId;
        if (!pid) return Promise.reject(new Error('no project'));
        return completeCode(pid, req, signal);
      },
      getConfig: () => useCompletionStore.getState().config(),
      onSuggest: (text, ctx) => {
        if (disposed || document.activeElement !== el) return;
        if (document.querySelector('.vv-ac')) return; // dropdown open — drop the arrival
        // Discard if the caret (or document) moved since the request was made.
        const now = buildCtx(el, getDocContext);
        if (!now || now.prefix !== ctx.prefix || now.suffix !== ctx.suffix) return;
        showGhost(text);
      },
      onClear: clearGhost,
      onResult: (res) => useCompletionStore.getState().recordResult(res),
      onError: () => {
        /* best-effort in the Visual view; the Code view owns credit/auth handling */
      },
    });

    const reschedule = () => {
      const ctx = buildCtx(el, getDocContext);
      if (ctx) scheduler.schedule(ctx);
    };

    const onInput = (e: Event) => {
      if ((e.target as HTMLElement).closest?.('input')) return; // chip editor
      clearGhost();
      reschedule();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input')) return;
      const ghost = el.querySelector('[data-ghost]');
      if (e.key === 'Tab' && ghost) {
        e.preventDefault();
        const text = ghost.textContent ?? '';
        const accepted = document.createTextNode(text);
        ghost.replaceWith(accepted);
        const sel = window.getSelection();
        if (sel) {
          const r = document.createRange();
          r.setStart(accepted, text.length);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        scheduler.clearRejection();
        reschedule(); // chain the next suggestion
      } else if (e.key === 'Escape' && ghost) {
        e.preventDefault();
        const ctx = buildCtx(el, getDocContext);
        if (ctx) scheduler.recordRejection(ctx.pos);
        clearGhost();
      }
    };

    const onBlur = () => {
      clearGhost();
      scheduler.abort();
    };

    const onMouseUp = () => clearGhost(); // a click moves the caret — stale ghost

    el.addEventListener('input', onInput);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('blur', onBlur);
    el.addEventListener('mouseup', onMouseUp);
    return () => {
      disposed = true;
      scheduler.abort();
      el.removeEventListener('input', onInput);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('mouseup', onMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
