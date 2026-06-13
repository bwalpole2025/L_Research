'use client';

import { useEffect, useRef, useState } from 'react';
import { useDialogStore } from '@/lib/dialogStore';
import { useFocusTrap } from '@/lib/a11y';

/**
 * Renders the active in-app dialog (see lib/dialogStore) — a themed replacement
 * for window.prompt / confirm / alert. Mounted once in the root layout. Enter
 * confirms, Esc cancels; a prompt autofocuses and selects its text.
 */
export function AppDialog() {
  const active = useDialogStore((s) => s.active);
  const close = useDialogStore((s) => s.close);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(Boolean(active), panelRef);

  // Seed the input + move focus when a dialog opens.
  useEffect(() => {
    if (!active) return;
    if (active.kind === 'prompt') {
      setValue(active.defaultValue ?? '');
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => confirmRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [active]);

  if (!active) return null;

  const isPrompt = active.kind === 'prompt';
  const isAlert = active.kind === 'alert';
  const submit = () => {
    if (isPrompt) {
      const v = value.trim();
      if (!v) return; // empty prompt = no-op (Cancel to dismiss)
      close(v);
    } else {
      close(true);
    }
  };
  const cancel = () => close(isPrompt ? null : false);

  const confirmLabel = active.confirmLabel ?? (isPrompt ? 'Save' : isAlert ? 'OK' : 'Confirm');

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={cancel}
      data-testid="app-dialog"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={active.title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        className="w-full max-w-[420px] overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface-raised)] shadow-[var(--ls-shadow-soft)]"
      >
        <div className="px-5 pb-4 pt-4">
          <h2 className="text-[15px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
            {active.title}
          </h2>
          {active.message && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-[var(--ls-muted)]">{active.message}</p>}
          {isPrompt && (
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={active.placeholder ?? ''}
              data-testid="app-dialog-input"
              className="mt-3 w-full rounded-[9px] border border-[var(--ls-line-strong)] bg-[var(--ls-surface)] px-3 py-2 text-[14px] text-[var(--ls-text)] outline-none transition-colors focus:border-[var(--ls-brand)] placeholder:text-[var(--ls-muted)]"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--ls-line)] bg-[var(--ls-surface-muted)] px-5 py-3">
          {!isAlert && (
            <button
              type="button"
              data-testid="app-dialog-cancel"
              onClick={cancel}
              className="rounded-[9px] border border-[var(--ls-line-strong)] px-3.5 py-1.5 text-[13px] text-[var(--ls-text)] transition-colors hover:bg-[var(--ls-surface)]"
            >
              {active.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button
            type="button"
            ref={confirmRef}
            data-testid="app-dialog-confirm"
            onClick={submit}
            className={`rounded-[9px] px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors ${
              active.destructive ? 'bg-rose-500 hover:bg-rose-600' : 'bg-[var(--ls-brand)] hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
