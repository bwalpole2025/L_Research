'use client';

import { create } from 'zustand';
import { decayedUsageScore, type UsageScope, type UsageStatRow } from '@latex-studio/shared';
import { api } from './api';
import { useEditorStore } from './store';

/**
 * ADAPTIVE AUTOCOMPLETE — the client side. Local and deterministic: no network
 * on the ranking path, no model. Three layers, fastest first:
 *  · in-memory maps     — O(1) score lookups on every keystroke;
 *  · IndexedDB mirror   — instant ranking on reload, before any round-trip;
 *  · UsageStat (server) — the durable store; accepts are batched to it
 *                         (debounced), and it reconciles the caches on open.
 *
 * SCOPING: command/environment/snippet/package habits are general typing
 * habits → "app" scope, shared across projects. cite-key / label / file-path
 * usage is document-specific → project scope, never leaks between projects.
 * Privacy: this is local usage data; it never leaves this machine.
 */

// Category → scope. Keys are namespaced "<category>:<name>" so a popular
// command can never influence ranking inside \cite{} and vice versa.
export type UsageCategory = 'cmd' | 'env' | 'snippet' | 'pkg' | 'class' | 'cite' | 'label' | 'gfx' | 'input';

const APP_CATEGORIES: ReadonlySet<UsageCategory> = new Set(['cmd', 'env', 'snippet', 'pkg', 'class']);

export function usageScope(category: UsageCategory): UsageScope {
  return APP_CATEGORIES.has(category) ? 'app' : 'project';
}

export interface UsageEntry {
  count: number;
  score: number; // decayed sum at lastUsedAt (shared formula)
  firstUsedAt: string;
  lastUsedAt: string;
}

// The usage boost is added ON TOP of each source's tier boost (0 / 10 / 50 /
// 90…). Tiers are ≥10 apart, so capping the usage contribution at 8 reorders
// items WITHIN a tier but can never lift one across tiers — and CodeMirror only
// ranks items its matcher already accepted, so popularity can never surface a
// non-matching item.
export const USAGE_BOOST_CAP = 8;

// ── State ─────────────────────────────────────────────────────────────────────

const mem = {
  app: new Map<string, UsageEntry>(),
  project: new Map<string, UsageEntry>(),
  projectId: null as string | null,
  hydratedFor: null as string | null,
  /** Last project a hydrate was STARTED for — even a failed attempt must not
   *  be retried per keystroke (the ranking path stays network-free). */
  attemptedFor: null as string | null,
  hydrating: false,
};

/** Bumped on hydrate/reset so React surfaces (Settings top-N) re-read. */
export const useUsageVersion = create<{ v: number; bump: () => void }>((set) => ({
  v: 0,
  bump: () => set((s) => ({ v: s.v + 1 })),
}));

interface AdaptiveState {
  adaptive: boolean;
  setAdaptive: (v: boolean) => void;
}

const ADAPTIVE_KEY = 'latex-studio:adaptive-suggestions';

export const useAdaptiveStore = create<AdaptiveState>((set) => ({
  adaptive: typeof window === 'undefined' ? true : window.localStorage.getItem(ADAPTIVE_KEY) !== 'false',
  setAdaptive(v) {
    set({ adaptive: v });
    try {
      window.localStorage.setItem(ADAPTIVE_KEY, String(v));
    } catch {
      /* ignore */
    }
  },
}));

// ── IndexedDB mirror (instant ranking on reload; absent in jsdom → skipped) ──

const IDB_NAME = 'latex-studio-usage';
const IDB_STORE = 'stats';

function openIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbPut(idbKey: string, entry: UsageEntry): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(entry, idbKey);
}

async function idbLoadAll(): Promise<Map<string, UsageEntry>> {
  const db = await openIdb();
  const out = new Map<string, UsageEntry>();
  if (!db) return out;
  return new Promise((resolve) => {
    const store = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(out);
      out.set(String(cursor.key), cursor.value as UsageEntry);
      cursor.continue();
    };
    req.onerror = () => resolve(out);
  });
}

async function idbClear(prefix: string): Promise<void> {
  const db = await openIdb();
  if (!db) return;
  const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
  const req = store.openCursor();
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor) return;
    if (String(cursor.key).startsWith(prefix)) cursor.delete();
    cursor.continue();
  };
}

// IDB keys carry the scope: "app|cmd:frac" or "<projectId>|cite:basset1888".
const idbKeyFor = (scope: UsageScope, key: string) => `${scope === 'app' ? 'app' : (mem.projectId ?? '?')}|${key}`;

// ── Hydration (IDB first, then the server reconciles) ────────────────────────

export async function hydrateUsage(projectId: string): Promise<void> {
  if (mem.hydratedFor === projectId || mem.hydrating) return;
  mem.hydrating = true;
  mem.attemptedFor = projectId;
  mem.projectId = projectId;
  mem.project = new Map(); // project habits never leak between projects
  try {
    // 1. IndexedDB — instant, no round-trip.
    const cached = await idbLoadAll();
    for (const [idbKey, entry] of cached) {
      const [scope, key] = [idbKey.slice(0, idbKey.indexOf('|')), idbKey.slice(idbKey.indexOf('|') + 1)];
      if (scope === 'app') mem.app.set(key, entry);
      else if (scope === projectId) mem.project.set(key, entry);
    }
    useUsageVersion.getState().bump();
    // 2. Server — durable truth; refreshes both caches.
    const res = await api.getUsage(projectId);
    const toEntry = (r: UsageStatRow): UsageEntry => ({ count: r.count, score: r.score, firstUsedAt: r.firstUsedAt, lastUsedAt: r.lastUsedAt });
    for (const r of res.app) mem.app.set(r.key, toEntry(r));
    for (const r of res.project) mem.project.set(r.key, toEntry(r));
    mem.hydratedFor = projectId;
    useUsageVersion.getState().bump();
  } catch {
    /* offline: IDB layer still ranks */
  } finally {
    mem.hydrating = false;
  }
}

/** Synchronous, callable from the completion source on every keystroke. */
export function hydrateUsageInBackground(): void {
  const projectId = useEditorStore.getState().projectId;
  if (!projectId || mem.attemptedFor === projectId || mem.hydrating) return;
  void hydrateUsage(projectId);
}

// ── Recording accepts (memory + IDB now; server debounced/batched) ──────────

let pending: Array<{ key: string; scope: UsageScope; at: string }> = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 1500;

function flushSoon(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const events = pending;
    pending = [];
    const projectId = mem.projectId;
    if (!projectId || events.length === 0) return;
    void api.postUsage(projectId, { events }).catch(() => {
      pending = [...events, ...pending]; // retry with the next batch
    });
  }, FLUSH_DELAY_MS);
}

export function recordAccept(category: UsageCategory, name: string, at = Date.now()): void {
  const key = `${category}:${name}`;
  const scope = usageScope(category);
  const map = scope === 'app' ? mem.app : mem.project;
  const prev = map.get(key);
  const entry: UsageEntry = prev
    ? {
        count: prev.count + 1,
        score: decayedUsageScore(prev.score, prev.lastUsedAt, at) + 1,
        firstUsedAt: prev.firstUsedAt,
        lastUsedAt: new Date(at).toISOString(),
      }
    : { count: 1, score: 1, firstUsedAt: new Date(at).toISOString(), lastUsedAt: new Date(at).toISOString() };
  map.set(key, entry);
  void idbPut(idbKeyFor(scope, key), entry);
  pending.push({ key, scope, at: new Date(at).toISOString() });
  flushSoon();
}

// ── Ranking lookup (O(1), no network, no await) ──────────────────────────────

/**
 * The ranking boost for one candidate: 0 with no history (cold start → the
 * source's static order stands) or when adaptive ranking is off; otherwise a
 * log-squashed decayed score in [1, USAGE_BOOST_CAP]. Monotonic in the score,
 * so frequent-and-recent sorts first within its relevance tier.
 */
export function usageBoost(category: UsageCategory, name: string, now = Date.now()): number {
  if (!useAdaptiveStore.getState().adaptive) return 0;
  const map = usageScope(category) === 'app' ? mem.app : mem.project;
  const entry = map.get(`${category}:${name}`);
  if (!entry) return 0;
  const score = decayedUsageScore(entry.score, entry.lastUsedAt, now);
  if (score < 0.05) return 0; // fully faded habits stop influencing order
  return Math.min(USAGE_BOOST_CAP, 1 + Math.floor(Math.log2(1 + score) * 2));
}

// ── Settings: transparency + reset ───────────────────────────────────────────

export function topUsage(scope: UsageScope, n = 10, now = Date.now()): Array<{ key: string; count: number; score: number }> {
  const map = scope === 'app' ? mem.app : mem.project;
  return [...map.entries()]
    .map(([key, e]) => ({ key, count: e.count, score: decayedUsageScore(e.score, e.lastUsedAt, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export async function resetUsage(scope: UsageScope): Promise<void> {
  const projectId = mem.projectId;
  (scope === 'app' ? mem.app : mem.project).clear();
  await idbClear(scope === 'app' ? 'app|' : `${projectId ?? '?'}|`);
  if (projectId) await api.deleteUsage(projectId, scope).catch(() => undefined);
  useUsageVersion.getState().bump();
}

// ── Test hooks (unit tests inject state directly; not used by app code) ──────

export function __resetUsageForTests(): void {
  mem.app.clear();
  mem.project.clear();
  mem.projectId = null;
  mem.hydratedFor = null;
  mem.attemptedFor = null;
  mem.hydrating = false;
  pending = [];
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

export function __injectUsageForTests(category: UsageCategory, name: string, entry: UsageEntry): void {
  (usageScope(category) === 'app' ? mem.app : mem.project).set(`${category}:${name}`, entry);
}

export function __setProjectForTests(projectId: string | null): void {
  mem.projectId = projectId;
  mem.project = new Map();
}
