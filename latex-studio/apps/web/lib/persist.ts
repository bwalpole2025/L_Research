import type { ProjectLayout, Theme } from './types';

/** localStorage helpers. All are SSR-safe (no-op when there is no window). */

const LAYOUT_PREFIX = 'latex-studio:layout:';
const LAST_PROJECT_KEY = 'latex-studio:lastProject';
export const THEME_KEY = 'latex-studio:theme';

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

export function loadLayout(projectId: string): ProjectLayout | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(LAYOUT_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProjectLayout;
    if (!Array.isArray(parsed.openFileIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLayout(projectId: string, layout: ProjectLayout): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(LAYOUT_PREFIX + projectId, JSON.stringify(layout));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function loadLastProject(): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(LAST_PROJECT_KEY);
}

export function saveLastProject(projectId: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(LAST_PROJECT_KEY, projectId);
  } catch {
    /* ignore */
  }
}

const COMPILE_ON_SAVE_KEY = 'latex-studio:compileOnSave';

export function loadCompileOnSave(): boolean {
  if (!hasWindow()) return false;
  return window.localStorage.getItem(COMPILE_ON_SAVE_KEY) === 'true';
}

export function saveCompileOnSave(value: boolean): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(COMPILE_ON_SAVE_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

export function loadTheme(): Theme | null {
  if (!hasWindow()) return null;
  const t = window.localStorage.getItem(THEME_KEY);
  return t === 'dark' || t === 'light' ? t : null;
}

export function saveTheme(theme: Theme): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}
