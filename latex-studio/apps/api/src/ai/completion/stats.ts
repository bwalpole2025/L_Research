import type { AiStatsBucket, AiStatsResponse, DailyCount, LatencyStats } from '@latex-studio/shared';

export interface StatRow {
  provider: string | null;
  model: string;
  variant: string | null;
  latencyMs: number;
  ok: boolean;
  createdAt: Date | string;
}

/** Nearest-rank percentile of an ascending-sorted array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx] ?? 0;
}

function latencyStats(latencies: number[]): LatencyStats {
  const lat = [...latencies].sort((a, b) => a - b);
  if (lat.length === 0) return { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0 };
  return {
    count: lat.length,
    p50: percentile(lat, 50),
    p95: percentile(lat, 95),
    p99: percentile(lat, 99),
    min: lat[0] ?? 0,
    max: lat[lat.length - 1] ?? 0,
  };
}

/** Aggregate /complete call logs into per-(provider,model,variant) percentiles. */
export function buildStats(rows: StatRow[]): AiStatsResponse {
  const groups = new Map<string, StatRow[]>();
  for (const r of rows) {
    const key = `${r.provider ?? 'unknown'}|${r.model}|${r.variant ?? 'n/a'}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const buckets: AiStatsBucket[] = [];
  for (const [key, rs] of groups) {
    const [provider = 'unknown', model = '', variant = 'n/a'] = key.split('|');
    const oks = rs.filter((r) => r.ok);
    buckets.push({
      provider,
      model,
      variant,
      okRate: rs.length ? oks.length / rs.length : 0,
      stats: latencyStats(oks.map((r) => r.latencyMs)),
    });
  }
  buckets.sort((a, b) => a.variant.localeCompare(b.variant) || a.model.localeCompare(b.model));

  const dailyMap = new Map<string, number>();
  for (const r of rows) {
    const d = typeof r.createdAt === 'string' ? new Date(r.createdAt) : r.createdAt;
    const day = d.toISOString().slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
  }
  const daily: DailyCount[] = [...dailyMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { buckets, daily, totalCompletions: rows.length };
}
