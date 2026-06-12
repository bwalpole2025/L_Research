'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ConnectorKind, ConnectorStatus, Project } from '@latex-studio/shared';
import { api } from '@/lib/api';
import { useConnectorsStore } from '@/lib/connectorsStore';
import { AppShell, PageHeader } from '@/components/AppNav';
import { RequireSession } from '@/components/RequireSession';

/**
 * REFERENCE-LIBRARY PLUGINS. The studio is local-first: the BibTeX importer is
 * fully local; the DOI lookup is the one explicitly-marked action that calls
 * the internet (doi.org), and only when clicked; the Zotero connector talks to
 * the Zotero DESKTOP app's local HTTP server — nothing cloud.
 */

function Badge({ kind }: { kind: 'working' | 'internet' | 'experimental' }) {
  const styles = {
    working: 'border-emerald-300 text-emerald-700 dark:border-emerald-500/40 dark:text-emerald-300',
    internet: 'border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300',
    experimental: 'border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400',
  } as const;
  const label = { working: 'working', internet: 'requires internet', experimental: 'experimental' } as const;
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${styles[kind]}`}>{label[kind]}</span>;
}

const KIND_LABEL: Record<ConnectorKind, string> = {
  model: 'Model providers (subscription — no API key)',
  storage: 'Storage & content (OAuth)',
  literature: 'Literature sources',
};
const KIND_ORDER: ConnectorKind[] = ['model', 'storage', 'literature'];

/** One connector row: status, shown scopes, and the right connect/disconnect action. */
function ConnectorRow({ c }: { c: ConnectorStatus }) {
  const connect = useConnectorsStore((s) => s.connect);
  const configure = useConnectorsStore((s) => s.configure);
  const disconnect = useConnectorsStore((s) => s.disconnect);
  const cancel = useConnectorsStore((s) => s.cancel);
  const busyId = useConnectorsStore((s) => s.busyId);
  const busy = busyId === c.id;
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const isOauth = c.authType === 'oauth2';
  const needsSetup = isOauth && !c.configured;
  const dot = c.connected ? 'bg-emerald-500' : c.wired ? 'bg-zinc-300 dark:bg-zinc-600' : 'bg-amber-400';

  // Save the OAuth app credentials, then kick off the consent redirect.
  const saveAndConnect = async () => {
    if (await configure(c.id, clientId.trim(), clientSecret.trim())) {
      setShowSetup(false);
      await connect(c.id);
    }
  };

  return (
    <div data-testid={`connector-${c.id}`} className="flex flex-col gap-2 border-b border-zinc-100 py-3.5 last:border-0 dark:border-[#161d31]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 flex-none rounded-full ${dot}`} />
            <span className="text-[15px] font-medium text-zinc-900 dark:text-[#eef1f8]">{c.name}</span>
            <span data-testid={`connector-status-${c.id}`} className="text-[11px] uppercase tracking-wide text-zinc-400">
              {c.authType === 'none' ? 'ready' : c.connected ? 'connected' : c.wired ? 'not connected' : 'coming soon'}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{c.description}</p>
          {c.scopes.length > 0 && (
            <p data-testid={`connector-scopes-${c.id}`} className="mt-1 text-[11px] text-zinc-400">
              Scopes: <span className="font-mono">{(c.connected && c.scopesGranted.length ? c.scopesGranted : c.scopes).join(', ')}</span>
            </p>
          )}
          {c.detail && <p className="mt-1 text-[11px] text-zinc-400">{c.detail}</p>}
          {(c.accountLabel || c.lastUsedAt) && (
            <p className="mt-1 text-[11px] text-zinc-400">
              {c.accountLabel}
              {c.accountLabel && c.lastUsedAt ? ' · ' : ''}
              {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleString()}` : ''}
            </p>
          )}
        </div>

        <div className="flex flex-none items-center gap-2">
          {busy ? (
            // While an action is in flight, the only control is a always-pressable
            // Cancel — so the button can never wedge on "Connecting…".
            <>
              <span className="text-xs text-zinc-400">Connecting…</span>
              <button
                type="button"
                data-testid={`connector-cancel-${c.id}`}
                onClick={() => cancel()}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </>
          ) : c.authType === 'none' ? (
            <span className="text-xs text-zinc-400">No sign-in needed</span>
          ) : c.authType === 'subscriptionCli' ? (
            <button
              type="button"
              data-testid={`connector-connect-${c.id}`}
              onClick={() => void connect(c.id)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Recheck
            </button>
          ) : c.connected ? (
            <button
              type="button"
              data-testid={`connector-disconnect-${c.id}`}
              onClick={() => void disconnect(c.id)}
              className="rounded-md border border-rose-300 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
            >
              Disconnect
            </button>
          ) : c.authType === 'apiKey' ? (
            <button
              type="button"
              disabled={!c.wired}
              data-testid={`connector-connect-${c.id}`}
              onClick={() => setShowKey((v) => !v)}
              className="rounded-md bg-[#4e68f5] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#5f78f8] disabled:opacity-50"
            >
              Connect
            </button>
          ) : needsSetup ? (
            <button
              type="button"
              disabled={!c.wired}
              data-testid={`connector-setup-${c.id}`}
              onClick={() => setShowSetup((v) => !v)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Set up
            </button>
          ) : (
            <button
              type="button"
              disabled={!c.wired}
              data-testid={`connector-connect-${c.id}`}
              onClick={() => void connect(c.id)}
              className="rounded-md bg-[#4e68f5] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#5f78f8] disabled:opacity-50"
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {showKey && c.authType === 'apiKey' && !c.connected && (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder={`${c.name} API key`}
            data-testid={`connector-key-${c.id}`}
            className="w-72 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
          />
          <button
            type="button"
            disabled={!keyInput.trim() || busy}
            onClick={() => void connect(c.id, keyInput.trim())}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Save key
          </button>
        </div>
      )}

      {showSetup && needsSetup && (
        <div data-testid={`connector-setup-form-${c.id}`} className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-[13px] dark:border-[#243049] dark:bg-[#0d1322]">
          <p className="text-zinc-600 dark:text-[#aab3c8]">
            Register an OAuth app{c.setupUrl && (
              <> at{' '}
                <a href={c.setupUrl} target="_blank" rel="noreferrer" className="text-[#4e68f5] underline">
                  {new URL(c.setupUrl).host}
                </a>
              </>
            )}{' '}and add this <strong>redirect URI</strong>:
          </p>
          {c.redirectUri && (
            <div className="mt-1.5 flex items-center gap-2">
              <code data-testid={`connector-redirect-${c.id}`} className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] text-zinc-700 dark:bg-[#0a0e18] dark:text-[#c6cde0]">
                {c.redirectUri}
              </code>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(c.redirectUri ?? '')}
                className="rounded border border-zinc-300 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Copy
              </button>
            </div>
          )}
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="Client ID"
              data-testid={`connector-clientid-${c.id}`}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 sm:w-56"
            />
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="Client secret"
              data-testid={`connector-clientsecret-${c.id}`}
              className="w-full rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700 sm:w-56"
            />
            <button
              type="button"
              disabled={!clientId.trim() || !clientSecret.trim() || busy}
              data-testid={`connector-save-${c.id}`}
              onClick={() => void saveAndConnect()}
              className="rounded-md bg-[#4e68f5] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#5f78f8] disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save & connect'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-zinc-400">Stored encrypted on this machine — never sent to the browser again.</p>
        </div>
      )}
    </div>
  );
}

function ConnectorsSection() {
  const connectors = useConnectorsStore((s) => s.connectors);
  const loading = useConnectorsStore((s) => s.loading);
  const error = useConnectorsStore((s) => s.error);
  const load = useConnectorsStore((s) => s.load);
  const cancel = useConnectorsStore((s) => s.cancel);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    cancel(); // clear any stale "Connecting…" left over from a prior attempt
    void load();
    // Surface the OAuth callback result (set by the api redirect back to /plugins).
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) setBanner(`Connected ${params.get('connected')} ✓`);
    else if (params.get('error')) setBanner(`Connection failed: ${params.get('error')}`);
    if (params.get('connected') || params.get('error')) {
      window.history.replaceState({}, '', '/plugins');
    }
    // Safari restores the page from back-forward cache without re-running effects;
    // `pageshow` (persisted) is our signal to clear a frozen busy state + refresh.
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        cancel();
        void load();
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, [load, cancel]);

  const byKind = useMemo(() => {
    const groups = new Map<ConnectorKind, ConnectorStatus[]>();
    for (const c of connectors) groups.set(c.kind, [...(groups.get(c.kind) ?? []), c]);
    return groups;
  }, [connectors]);

  const card =
    'rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)] dark:border-[#1d2640] dark:bg-[#0d1322] dark:shadow-[0_18px_50px_-28px_rgba(0,0,0,0.7)]';

  return (
    <section className="mb-8" data-testid="connectors-section">
      <h2 className="mb-1 text-[17px] font-medium text-zinc-900 dark:text-[#eef1f8]" style={{ fontFamily: 'var(--ls-serif)' }}>
        Connectors
      </h2>
      <p className="mb-4 text-sm text-zinc-500">
        Models run on your subscription via each vendor&apos;s CLI (no API keys). Storage &amp; content connect over OAuth —
        tokens are encrypted on this machine and never reach the browser. Imported content is treated as data, never commands.
      </p>
      {banner && (
        <div data-testid="connectors-banner" className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-[#243049] dark:bg-[#0d1322] dark:text-[#aab3c8]">
          {banner}
        </div>
      )}
      {error && <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
      <div className="grid gap-5">
        {KIND_ORDER.map((kind) => {
          const rows = byKind.get(kind) ?? [];
          if (rows.length === 0) return null;
          return (
            <div key={kind} className={card}>
              <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-[0.13em] text-zinc-500 dark:text-[#6b7693]">{KIND_LABEL[kind]}</h3>
              <div>
                {rows.map((c) => (
                  <ConnectorRow key={c.id} c={c} />
                ))}
              </div>
            </div>
          );
        })}
        {loading && connectors.length === 0 && <p className="text-sm text-zinc-400">Loading connectors…</p>}
      </div>
    </section>
  );
}

function PluginsIndex() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [target, setTarget] = useState('');

  // BibTeX import
  const [importMsg, setImportMsg] = useState<string | null>(null);
  // DOI lookup
  const [doi, setDoi] = useState('');
  const [doiResult, setDoiResult] = useState<string | null>(null);
  const [doiBusy, setDoiBusy] = useState(false);
  // Zotero
  const [zotero, setZotero] = useState<'unknown' | 'detected' | 'absent'>('unknown');

  useEffect(() => {
    void api.listProjects().then((ps) => {
      setProjects(ps);
      if (ps[0]) setTarget(ps[0].id);
    });
  }, []);

  const importBib = async (file: File) => {
    if (!target) return;
    try {
      const content = await file.text();
      await api.createFile(target, file.name, content);
      setImportMsg(`Imported ${file.name} into ${projects.find((p) => p.id === target)?.name ?? 'project'} ✓`);
    } catch (err) {
      setImportMsg(`Import failed: ${err instanceof Error ? err.message : String(err)} (does ${file.name} already exist?)`);
    }
  };

  const lookupDoi = async () => {
    setDoiBusy(true);
    setDoiResult(null);
    try {
      const res = await fetch(`https://doi.org/${encodeURIComponent(doi.trim())}`, {
        headers: { Accept: 'application/x-bibtex' },
      });
      setDoiResult(res.ok ? await res.text() : `Lookup failed (HTTP ${res.status}).`);
    } catch {
      setDoiResult('Lookup failed — no internet connection, or the DOI service refused the request.');
    } finally {
      setDoiBusy(false);
    }
  };

  const detectZotero = async () => {
    try {
      const res = await fetch('http://127.0.0.1:23119/connector/ping');
      setZotero(res.ok ? 'detected' : 'absent');
    } catch {
      setZotero('absent');
    }
  };

  const card =
    'rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)] dark:border-[#1d2640] dark:bg-[#0d1322] dark:shadow-[0_18px_50px_-28px_rgba(0,0,0,0.7)]';

  return (
    <AppShell>
      <div className="mx-auto max-w-[860px] px-11 pb-20 pt-12">
        <PageHeader
          eyebrow="Workspace · Connectors"
          title="Plugins"
          sub="Connect reference libraries to the studio. Local-first; anything that touches the network says so."
        />

        <div className="mt-8">
          <ConnectorsSection />
        </div>

        <div className="grid gap-5">
          {/* ── BibTeX import ── */}
          <section className={card} data-testid="plugin-bibtex">
            <div className="flex items-center gap-3">
              <h2 className="text-[17px] font-medium text-zinc-900 dark:text-[#eef1f8]" style={{ fontFamily: 'var(--ls-serif)' }}>Import a BibTeX file</h2>
              <Badge kind="working" />
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Add a <span className="font-mono text-xs">.bib</span> exported from Zotero, Mendeley, JabRef or a journal page straight into a project.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                data-testid="plugin-bibtex-project"
                className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <label className="cursor-pointer rounded-[9px] bg-[#4e68f5] px-3.5 py-2 text-sm font-semibold text-[#ffffff] shadow-[0_4px_14px_rgba(78,104,245,0.30)] transition-colors hover:bg-[#5f78f8]">
                Choose .bib file
                <input
                  type="file"
                  accept=".bib"
                  className="hidden"
                  data-testid="plugin-bibtex-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importBib(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {importMsg && <p data-testid="plugin-bibtex-msg" className="mt-2 text-xs text-zinc-500">{importMsg}</p>}
          </section>

          {/* ── DOI lookup ── */}
          <section className={card} data-testid="plugin-doi">
            <div className="flex items-center gap-3">
              <h2 className="text-[17px] font-medium text-zinc-900 dark:text-[#eef1f8]" style={{ fontFamily: 'var(--ls-serif)' }}>DOI → BibTeX lookup</h2>
              <Badge kind="internet" />
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Fetches the citation record from doi.org. This is the only action on this page that leaves your machine, and only when you click it.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                value={doi}
                onChange={(e) => setDoi(e.target.value)}
                placeholder="10.1017/jfm.2019.247"
                data-testid="plugin-doi-input"
                className="w-72 rounded-md border border-zinc-300 bg-transparent px-3 py-1.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-zinc-700"
              />
              <button
                type="button"
                onClick={() => void lookupDoi()}
                disabled={!doi.trim() || doiBusy}
                data-testid="plugin-doi-go"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                {doiBusy ? 'Fetching…' : 'Fetch BibTeX'}
              </button>
            </div>
            {doiResult && (
              <div className="mt-3">
                <pre data-testid="plugin-doi-result" className="max-h-48 overflow-auto rounded-md bg-zinc-100 p-3 font-mono text-[11px] leading-relaxed dark:bg-zinc-950">{doiResult}</pre>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(doiResult)}
                  className="mt-2 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Copy
                </button>
              </div>
            )}
          </section>

          {/* ── Zotero (local) ── */}
          <section className={card} data-testid="plugin-zotero">
            <div className="flex items-center gap-3">
              <h2 className="text-[17px] font-medium text-zinc-900 dark:text-[#eef1f8]" style={{ fontFamily: 'var(--ls-serif)' }}>Zotero (desktop, local)</h2>
              <Badge kind="experimental" />
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              Talks to the Zotero desktop app&apos;s local server (<span className="font-mono text-xs">127.0.0.1:23119</span>) — no cloud account involved.
              For now: detect Zotero, then export your collection as Better BibTeX and import it with the plugin above.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void detectZotero()}
                data-testid="plugin-zotero-detect"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Detect Zotero
              </button>
              {zotero === 'detected' && <span className="text-sm text-emerald-600 dark:text-emerald-400">Zotero is running ✓</span>}
              {zotero === 'absent' && <span className="text-sm text-zinc-500">Not detected — is the Zotero desktop app open?</span>}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

export default function PluginsPage() {
  return (
    <RequireSession>
      <PluginsIndex />
    </RequireSession>
  );
}
