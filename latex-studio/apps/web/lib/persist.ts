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
  // Default ON: the PDF keeps itself fresh as you work ("live preview").
  // An explicit user choice (either way) is respected.
  if (!hasWindow()) return true;
  return window.localStorage.getItem(COMPILE_ON_SAVE_KEY) !== 'false';
}

export function saveCompileOnSave(value: boolean): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(COMPILE_ON_SAVE_KEY, value ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}

// Home project-explorer UI state: which folders are expanded and which folder is
// selected. App-level (not per-project), so a single key.
const PROJECT_FOLDERS_KEY = 'latex-studio:projectFolders';

export interface ProjectFolderUi {
  expanded: string[];
  selected: string | null;
}

export function loadProjectFolderUi(): ProjectFolderUi {
  if (!hasWindow()) return { expanded: [], selected: null };
  try {
    const raw = window.localStorage.getItem(PROJECT_FOLDERS_KEY);
    if (!raw) return { expanded: [], selected: null };
    const parsed = JSON.parse(raw) as Partial<ProjectFolderUi>;
    return {
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded : [],
      selected: typeof parsed.selected === 'string' ? parsed.selected : null,
    };
  } catch {
    return { expanded: [], selected: null };
  }
}

export function saveProjectFolderUi(state: ProjectFolderUi): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(PROJECT_FOLDERS_KEY, JSON.stringify(state));
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

// ─── Product tour (onboarding) ───────────────────────────────────────────────
const TOUR_PREFIX = 'latex-studio:tour:';

/** Whether a one-time tour with this id has already been seen/dismissed. SSR-safe
 *  (returns true on the server so a tour never renders during SSR). */
export function loadTourSeen(id: string): boolean {
  if (!hasWindow()) return true;
  return window.localStorage.getItem(TOUR_PREFIX + id) === 'seen';
}

/** Mark a one-time tour as seen so it never auto-shows again. */
export function saveTourSeen(id: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(TOUR_PREFIX + id, 'seen');
  } catch {
    /* ignore */
  }
}
