'use client';

import { create } from 'zustand';

/**
 * In-app dialogs styled with the design tokens — a drop-in, promise-based
 * replacement for window.prompt / confirm / alert (which can't be themed and
 * look out of place). Any code (components OR stores) calls `dialog.prompt(…)`
 * etc.; a single <AppDialog/> mounted in the root layout renders the active one.
 */

export type DialogKind = 'prompt' | 'confirm' | 'alert';

export interface DialogSpec {
  title: string;
  /** Optional supporting line under the title. */
  message?: string;
  // prompt only:
  defaultValue?: string;
  placeholder?: string;
  // labels (sensible defaults per kind):
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm action in a destructive (rose) style — deletes, trash. */
  destructive?: boolean;
}

interface ActiveDialog extends DialogSpec {
  kind: DialogKind;
  resolve: (value: string | boolean | null) => void;
}

interface DialogState {
  active: ActiveDialog | null;
  /** Open a text-input dialog. Resolves to the trimmed value, or null on cancel. */
  prompt: (spec: DialogSpec) => Promise<string | null>;
  /** Open a yes/no dialog. Resolves true on confirm, false on cancel. */
  confirm: (spec: DialogSpec) => Promise<boolean>;
  /** Open a one-button notice. Resolves when dismissed. */
  alert: (spec: DialogSpec) => Promise<void>;
  /** Resolve + close the active dialog (used by <AppDialog/>). */
  close: (value: string | boolean | null) => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  active: null,
  prompt: (spec) =>
    new Promise<string | null>((resolve) =>
      set({ active: { ...spec, kind: 'prompt', resolve: (v) => resolve(typeof v === 'string' ? v : null) } }),
    ),
  confirm: (spec) =>
    new Promise<boolean>((resolve) =>
      set({ active: { ...spec, kind: 'confirm', resolve: (v) => resolve(v === true) } }),
    ),
  alert: (spec) =>
    new Promise<void>((resolve) =>
      set({ active: { ...spec, kind: 'alert', resolve: () => resolve() } }),
    ),
  close: (value) => {
    const a = get().active;
    set({ active: null });
    a?.resolve(value);
  },
}));

/** Non-hook accessor so non-React modules (zustand stores) can open dialogs too. */
export const dialog = {
  prompt: (spec: DialogSpec): Promise<string | null> => useDialogStore.getState().prompt(spec),
  confirm: (spec: DialogSpec): Promise<boolean> => useDialogStore.getState().confirm(spec),
  alert: (spec: DialogSpec): Promise<void> => useDialogStore.getState().alert(spec),
};
