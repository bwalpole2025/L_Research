'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCompletionStore } from '@/lib/completionStore';
import type { AiStatsBucket, AiStatsResponse } from '@/lib/types';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string | undefined }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function BucketRow({ b }: { b: AiStatsBucket }) {
  const over = b.stats.p95 > 1500;
  return (
    <tr className="border-t border-slate-100">
      <td className="px-3 py-1.5">{b.variant}</td>
      <td className="px-3 py-1.5 text-slate-500">{b.provider}</td>
      <td className="px-3 py-1.5 text-slate-500">{b.model}</td>
      <td className="px-3 py-1.5 text-right">{b.stats.count}</td>
      <td className="px-3 py-1.5 text-right">{b.stats.p50}</td>
      <td className={`px-3 py-1.5 text-right ${over ? 'text-amber-600' : 'text-emerald-600'}`}>{b.stats.p95}</td>
      <td className="px-3 py-1.5 text-right">{b.stats.p99}</td>
      <td className="px-3 py-1.5 text-right">{(b.okRate * 100).toFixed(0)}%</td>
    </tr>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<AiStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accepted = useCompletionStore((s) => s.accepted);
  const rejected = useCompletionStore((s) => s.rejected);

  useEffect(() => {
    api
      .getAiStats()
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const total = accepted + rejected;
  const acceptRate = total > 0 ? `${((accepted / total) * 100).toFixed(0)}%` : '—';
  const warm = stats?.buckets.find((b) => b.variant === 'warm');
  const baseline = stats?.buckets.find((b) => b.variant === 'baseline');

  return (
    <main className="mx-auto max-w-4xl bg-slate-50 p-8 text-slate-900">
      <h1 className="text-xl font-semibold">Completion stats</h1>
      <p className="mt-1 text-sm text-slate-500">
        Per-call latency from the server log (<code>AiCallLog</code>, route <code>complete</code>) plus local accept
        counters. Budget: 1.5&nbsp;s p95.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">Could not load stats: {error}</p>}

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Completions" value={String(stats?.totalCompletions ?? 0)} />
        <StatCard label="Accept rate" value={acceptRate} sub={`${accepted} accepted / ${rejected} rejected`} />
        <StatCard label="Warm p50" value={warm ? `${warm.stats.p50} ms` : '—'} />
        <StatCard label="Warm p95" value={warm ? `${warm.stats.p95} ms` : '—'} sub={warm && warm.stats.p95 > 1500 ? 'over budget' : undefined} />
      </div>

      {warm && baseline && (
        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Baseline vs warm</h2>
          <p className="mt-1 text-slate-600">
            Warm pre-warmed pool: p50 <b>{warm.stats.p50} ms</b> vs baseline p50 <b>{baseline.stats.p50} ms</b>{' '}
            ({baseline.stats.p50 > 0 ? `${Math.round((1 - warm.stats.p50 / baseline.stats.p50) * 100)}% faster` : '—'}).
            {warm.stats.p95 > 1500 && (
              <>
                {' '}
                p95 still exceeds the 1.5&nbsp;s budget — completions may benefit from{' '}
                <code>COMPLETIONS_PROVIDER=api</code> (Settings → Inline completions).
              </>
            )}
          </p>
        </div>
      )}

      <h2 className="mt-6 text-sm font-semibold">Latency by provider · model · variant</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">variant</th>
              <th className="px-3 py-2">provider</th>
              <th className="px-3 py-2">model</th>
              <th className="px-3 py-2 text-right">n</th>
              <th className="px-3 py-2 text-right">p50</th>
              <th className="px-3 py-2 text-right">p95</th>
              <th className="px-3 py-2 text-right">p99</th>
              <th className="px-3 py-2 text-right">ok</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.buckets ?? []).map((b) => (
              <BucketRow key={`${b.provider}-${b.model}-${b.variant}`} b={b} />
            ))}
            {stats && stats.buckets.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-3 text-center text-slate-400">
                  No completions recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="mt-6 text-sm font-semibold">Completions per day</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">date</th>
              <th className="px-3 py-2 text-right">count</th>
            </tr>
          </thead>
          <tbody>
            {(stats?.daily ?? []).map((d) => (
              <tr key={d.date} className="border-t border-slate-100">
                <td className="px-3 py-1.5">{d.date}</td>
                <td className="px-3 py-1.5 text-right">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
