'use client';

/**
 * Where Python "Run" executes.
 *  - 'client': in the user's browser via Pyodide (WASM) — never touches the host.
 *             The DEFAULT, so routine Python is off the server entirely.
 *  - 'server': the sandboxed server-side pyrun fallback (gVisor + caps + quota),
 *             for workloads Pyodide can't handle (a package without a WASM wheel,
 *             very large data, …). See docs/isolation.md.
 */
export type PythonRuntime = 'client' | 'server';

const STORAGE_KEY = 'ls.pythonRuntime';

/** Build-time default; only an explicit "server" flips it off the browser. */
export function defaultPythonRuntime(): PythonRuntime {
  return process.env.NEXT_PUBLIC_PYTHON_RUNTIME === 'server' ? 'server' : 'client';
}

/** The effective runtime: a per-user override (localStorage) over the default. */
export function getPythonRuntime(): PythonRuntime {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'client' || stored === 'server') return stored;
  }
  return defaultPythonRuntime();
}

export function setPythonRuntime(mode: PythonRuntime): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, mode);
}
