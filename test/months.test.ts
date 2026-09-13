import { describe, expect, it } from 'vitest';
import { bucketMonths, clampRange, daysInMonth, monthsBack, monthsInRange, todayUtc } from '../src/analysis/months';

describe('calendar months', () => {
  it('monthsBack spans N calendar months including the current one, across a year boundary', () => {
    expect(monthsBack('2026-09-05', 3)).toEqual({ since: '2026-07-01', until: '2026-09-05' });
    expect(monthsBack('2026-01-15', 2)).toEqual({ since: '2025-12-01', until: '2026-01-15' });
    expect(monthsInRange({ since: '2025-11-03', until: '2026-02-01' })).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(todayUtc(new Date('2026-09-05T23:59:00Z'))).toBe('2026-09-05');
  });

  it('clamps until to today and rejects since after until', () => {
    expect(clampRange({ since: '2026-08-01', until: '2026-12-31' }, '2026-09-05').until).toBe('2026-09-05');
    expect(() => clampRange({ since: '2026-09-10', until: '2026-09-01' }, '2026-09-30')).toThrow(/after/);
  });

  it('buckets from the calendar, zero-fills quiet months, prorates edges, and flags partial and pre-data months', () => {
    const rows = [
      { date: '2026-07-03', cost: 10 },
      { date: '2026-07-20', cost: 5 },
      { date: '2026-09-02', cost: 7 },
      { date: '2026-06-30', cost: 999 },
    ];
    const b = bucketMonths(rows, { since: '2026-07-01', until: '2026-09-05' }, { minDays: 7, dataStart: null });
    expect(b.map((m) => [m.month, m.amount, m.daysObserved, m.excluded])).toEqual([
      ['2026-07', 15, 31, null],
      ['2026-08', 0, 31, null],
      ['2026-09', 7, 5, 'partial'],
    ]);
  });

  it('excludes months before local data begins and counts observed days from the data start', () => {
    const b = bucketMonths([{ date: '2026-08-20', cost: 3 }], { since: '2026-06-01', until: '2026-09-05' }, { minDays: 7, dataStart: '2026-08-10' });
    expect(b.map((m) => [m.month, m.daysObserved, m.excluded])).toEqual([
      ['2026-06', 0, 'before-data'],
      ['2026-07', 0, 'before-data'],
      ['2026-08', 22, null],
      ['2026-09', 5, 'partial'],
    ]);
  });
});
