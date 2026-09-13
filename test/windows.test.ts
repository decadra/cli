import { describe, expect, it } from 'vitest';
import { denseSeries, percentiles, rollingSums, shortPeak, weeklyPeak } from '../src/analysis/windows';
import { projectMonth } from '../src/analysis/pace';

describe('windows', () => {
  it('dense series zero-fills and rolling sums slide over calendar days', () => {
    const rows = [
      { date: '2026-09-01', cost: 1 },
      { date: '2026-09-03', cost: 2 },
      { date: '2026-09-10', cost: 4 },
    ];
    const s = denseSeries(rows, { since: '2026-09-01', until: '2026-09-10' });
    expect(s).toEqual([1, 0, 2, 0, 0, 0, 0, 0, 0, 4]);
    expect(rollingSums(s, 7)).toEqual([3, 2, 2, 4]);
    expect(rollingSums([1, 2, 3], 7)).toEqual([6]);
    expect(rollingSums([], 7)).toEqual([]);
  });

  it('percentiles use nearest rank and empty input yields null', () => {
    expect(percentiles([])).toBeNull();
    expect(percentiles([5, 1, 3])).toEqual({ p50: 3, p95: 5, max: 5 });
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentiles(hundred)).toEqual({ p50: 50, p95: 95, max: 100 });
  });

  it('weekly and short peaks skip gaps and report the active block', () => {
    expect(weeklyPeak([], { since: '2026-09-01', until: '2026-09-10' })).toBeNull();
    const w = weeklyPeak([{ date: '2026-09-02', cost: 8 }, { date: '2026-09-09', cost: 1 }], { since: '2026-09-01', until: '2026-09-14' });
    expect(w?.kind).toBe('weekly');
    expect(w?.max).toBe(8);
    const s = shortPeak([
      { costUSD: 3, isGap: false, entries: 10, isActive: false },
      { costUSD: 0, isGap: true, entries: 0, isActive: false },
      { costUSD: 9, isGap: false, entries: 4, isActive: true },
    ]);
    expect(s.peak).toEqual({ kind: 'short', max: 9, p95: 9, p50: 3 });
    expect(s.activeIncluded).toBe(true);
    expect(s.fewBlocks).toBe(true);
  });

  it('pace projects straight-line and returns null with no observed days', () => {
    expect(projectMonth(50, 5, 30)).toBe(300);
    expect(projectMonth(50, 30, 30)).toBe(50);
    expect(projectMonth(50, 0, 30)).toBeNull();
  });
});
