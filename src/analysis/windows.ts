import type { WindowPeak } from './planfit';
import { addDays, daysBetweenInclusive, type DateRange, type DayCost } from './months';

/** Rolling-window and percentile math over plain arrays. Pure. */
export function denseSeries(rows: DayCost[], range: DateRange): number[] {
  const n = daysBetweenInclusive(range.since, range.until);
  const series = new Array<number>(Math.max(0, n)).fill(0);
  for (const r of rows) {
    if (r.date < range.since || r.date > range.until) continue;
    const i = daysBetweenInclusive(range.since, r.date) - 1;
    series[i] = (series[i] ?? 0) + r.cost;
  }
  return series;
}

export function rollingSums(series: number[], days = 7): number[] {
  if (!series.length) return [];
  if (series.length <= days) return [series.reduce((a, b) => a + b, 0)];
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < series.length; i += 1) {
    sum += series[i] as number;
    if (i >= days) sum -= series[i - days] as number;
    if (i >= days - 1) out.push(sum);
  }
  return out;
}

export function percentiles(values: number[]): { p50: number; p95: number; max: number } | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = (p: number): number => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] as number;
  return { p50: rank(0.5), p95: rank(0.95), max: s[s.length - 1] as number };
}

export function weeklyPeak(rows: DayCost[], range: DateRange): WindowPeak | null {
  const p = percentiles(rollingSums(denseSeries(rows, range), 7));
  if (!p || p.max === 0) return null;
  return { kind: 'weekly', max: p.max, p95: p.p95, p50: p.p50 };
}

export interface BlockLite {
  costUSD: number;
  isGap: boolean;
  entries: number;
  isActive: boolean;
}

export function shortPeak(blocks: BlockLite[]): { peak: WindowPeak | null; activeIncluded: boolean; fewBlocks: boolean } {
  const usable = blocks.filter((b) => !b.isGap && b.entries > 0);
  const p = percentiles(usable.map((b) => b.costUSD));
  if (!p || p.max === 0) return { peak: null, activeIncluded: false, fewBlocks: usable.length < 20 };
  return {
    peak: { kind: 'short', max: p.max, p95: p.p95, p50: p.p50 },
    activeIncluded: usable.some((b) => b.isActive),
    fewBlocks: usable.length < 20,
  };
}

export function windowEndsToday(range: DateRange, today: string): boolean {
  return range.until === today || addDays(range.until, 1) === today;
}
