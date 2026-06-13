/// <reference lib="webworker" />
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pyodide (CPython → WASM) worker. Runs the user's Python ENTIRELY in the
 * browser tab sandbox — the host never sees the code or the process. Loads
 * Pyodide from the CDN on first use, writes the project's files into the
 * in-memory FS, auto-installs imported packages (numpy/scipy/matplotlib/…), runs
 * the script, streams stdout/stderr, and captures matplotlib figures as PNGs.
 *
 * Classic worker (so `importScripts` works). Message protocol — see pyodideClient.ts.
 */

declare function importScripts(...urls: string[]): void;
declare const loadPyodide: (opts: { indexURL: string }) => Promise<any>;

const PYODIDE_VERSION = 'v0.26.4';
const CDN = `https://cdn.jsdelivr.net/pyodide/${PYODIDE_VERSION}/full/`;
const ROOT = '/home/pyodide/proj';

const post = (m: unknown): void => (self as unknown as Worker).postMessage(m);

let pyodidePromise: Promise<any> | null = null;
function getPyodide(): Promise<any> {
  if (!pyodidePromise) {
    importScripts(`${CDN}pyodide.js`);
    pyodidePromise = loadPyodide({ indexURL: CDN });
  }
  return pyodidePromise;
}

// Runs the script and returns a list of (name, base64-png) for every figure.
const BOOTSTRAP = `
import sys, runpy, io, base64, os
_figs = []
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:
    plt = None

def _capture():
    if plt is None:
        return
    for i, num in enumerate(plt.get_fignums(), 1):
        try:
            buf = io.BytesIO()
            plt.figure(num).savefig(buf, format="png", dpi=150, bbox_inches="tight")
            _figs.append(("figure_%02d.png" % i, base64.b64encode(buf.getvalue()).decode()))
        except Exception as exc:
            sys.stderr.write("[pyodide] figure capture failed: %s\\n" % exc)

if plt is not None:
    def _show(*a, **k):
        _capture()
        plt.close("all")
    plt.show = _show  # the ubiquitous plt.show() idiom becomes visible output

sys.argv = [__ls_script, *list(__ls_argv)]
os.chdir(os.path.dirname(__ls_script) or ".")
try:
    runpy.run_path(__ls_script, run_name="__main__")
finally:
    _capture()
_figs
`;

interface RunMessage {
  type: 'run';
  script: string; // project-relative path of the .py to run
  args: string[];
  files: Array<{ path: string; content: string; encoding: 'utf8' | 'base64' }>;
}

self.onmessage = async (ev: MessageEvent<RunMessage>): Promise<void> => {
  const msg = ev.data;
  if (msg.type !== 'run') return;

  let pyodide: any;
  try {
    pyodide = await getPyodide();
  } catch (err) {
    post({ type: 'error', message: `Could not load the in-browser Python runtime: ${String(err)}` });
    post({ type: 'done', status: 'failed', exitCode: null });
    return;
  }

  pyodide.setStdout({ batched: (s: string) => post({ type: 'stdout', chunk: s + '\n' }) });
  pyodide.setStderr({ batched: (s: string) => post({ type: 'stderr', chunk: s + '\n' }) });

  // Stage the project's files into the in-memory FS.
  try {
    pyodide.FS.mkdirTree(ROOT);
    for (const f of msg.files) {
      const full = `${ROOT}/${f.path}`;
      const dir = full.slice(0, full.lastIndexOf('/'));
      if (dir) pyodide.FS.mkdirTree(dir);
      if (f.encoding === 'base64') {
        const bin = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
        pyodide.FS.writeFile(full, bin);
      } else {
        pyodide.FS.writeFile(full, f.content);
      }
    }
  } catch (err) {
    post({ type: 'error', message: `Failed to stage project files: ${String(err)}` });
    post({ type: 'done', status: 'failed', exitCode: null });
    return;
  }

  const scriptFull = `${ROOT}/${msg.script}`;
  try {
    const src = pyodide.FS.readFile(scriptFull, { encoding: 'utf8' }) as string;
    // Auto-install packages the script imports (numpy/scipy/matplotlib/pandas/…).
    try {
      await pyodide.loadPackagesFromImports(src);
    } catch (err) {
      post({ type: 'stderr', chunk: `[pyodide] some packages could not be loaded in the browser: ${String(err)}\n` });
    }

    pyodide.globals.set('__ls_script', scriptFull);
    pyodide.globals.set('__ls_argv', msg.args ?? []);
    const result = await pyodide.runPythonAsync(BOOTSTRAP);
    const figures = (result?.toJs ? result.toJs() : []) as Array<[string, string]>;
    for (const [name, b64] of figures) {
      post({ type: 'figure', name, dataUrl: `data:image/png;base64,${b64}` });
    }
    result?.destroy?.();
    post({ type: 'done', status: 'success', exitCode: 0 });
  } catch (err) {
    // A Python-level exception lands here (Pyodide surfaces the traceback in .message).
    post({ type: 'stderr', chunk: `${(err as Error)?.message ?? String(err)}\n` });
    post({ type: 'done', status: 'failed', exitCode: 1 });
  } finally {
    pyodide.globals.set('__ls_script', undefined);
    pyodide.globals.set('__ls_argv', undefined);
  }
};
