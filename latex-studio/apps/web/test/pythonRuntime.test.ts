import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultPythonRuntime, getPythonRuntime, setPythonRuntime } from '../lib/python/runtime';

describe('python runtime selection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_PYTHON_RUNTIME;
  });
  afterEach(() => {
    window.localStorage.clear();
    delete process.env.NEXT_PUBLIC_PYTHON_RUNTIME;
  });

  it('defaults to client (in-browser Pyodide)', () => {
    expect(defaultPythonRuntime()).toBe('client');
    expect(getPythonRuntime()).toBe('client');
  });

  it('honours an explicit server build flag', () => {
    process.env.NEXT_PUBLIC_PYTHON_RUNTIME = 'server';
    expect(defaultPythonRuntime()).toBe('server');
    expect(getPythonRuntime()).toBe('server');
  });

  it('a per-user override beats the default', () => {
    setPythonRuntime('server');
    expect(getPythonRuntime()).toBe('server');
    setPythonRuntime('client');
    expect(getPythonRuntime()).toBe('client');
  });

  it('ignores a garbage stored value and falls back to the default', () => {
    window.localStorage.setItem('ls.pythonRuntime', 'nonsense');
    expect(getPythonRuntime()).toBe('client');
  });
});
