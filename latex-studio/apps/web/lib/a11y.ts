'use client';

import { useEffect, type RefObject } from 'react';

/** Focusable descendants of `root`, in DOM order, skipping hidden/disabled ones. */
function focusable(root: HTMLElement): HTMLElement[] {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Trap Tab focus inside `ref` while `active`, and restore focus to whatever was
 * focused before on deactivate. Use for modal dialogs (Esc handling stays with
 * the dialog). Capture-phase so it works regardless of where focus currently is.
 */
export function useFocusTrap(active: boolean, ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = ref.current;
      if (!root) return;
      const items = focusable(root);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const cur = document.activeElement;
      if (e.shiftKey) {
        if (cur === first || !root.contains(cur)) {
          e.preventDefault();
          last.focus();
        }
      } else if (cur === last || !root.contains(cur)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.();
    };
  }, [active, ref]);
}

/**
 * Roving keyboard nav for a dropdown menu: focus the first item on open;
 * ArrowUp/Down (wrapping) + Home/End move between items; Escape (and Tab) close
 * the menu and return focus to the trigger.
 */
export function useMenuNav(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  triggerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const root = ref.current;
    if (!root) return;
    const items = () => focusable(root);
    const focusId = window.setTimeout(() => items()[0]?.focus(), 0);
    const onKeyDown = (e: KeyboardEvent) => {
      const list = items();
      if (list.length === 0) return;
      const idx = list.indexOf(document.activeElement as HTMLElement);
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          list[(idx + 1 + list.length) % list.length]!.focus();
          break;
        case 'ArrowUp':
          e.preventDefault();
          list[(idx - 1 + list.length) % list.length]!.focus();
          break;
        case 'Home':
          e.preventDefault();
          list[0]!.focus();
          break;
        case 'End':
          e.preventDefault();
          list[list.length - 1]!.focus();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          triggerRef?.current?.focus();
          break;
        case 'Tab':
          onClose();
          break;
      }
    };
    root.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusId);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref, onClose, triggerRef]);
}
