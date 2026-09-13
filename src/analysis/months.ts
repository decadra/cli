import type { MonthlyUsage } from './planfit';

/** Calendar helpers, all UTC, all on YYYY-MM-DD strings. Pure. */
export interface DayCost {
  date: string;
  cost: number;
}

export interface DateRange {
  since: string;
  until: string;
}

export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function parseDate(d: string): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return { y, m, d: day };
}

export function fmt(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

export function daysInMonth(ym: string): number {
  const { y, m } = parseDate(`${ym}-01`);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parseDate(date);
  return fmt(y, m, d + n);
}

export function daysBetweenInclusive(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
}

/** N most recent calendar months including the current one. */
export function monthsBack(today: string, n: number): DateRange {
  const { y, m } = parseDate(today);
  return { since: fmt(y, m - (n - 1), 1), until: today };
}

export function clampRange(range: DateRange, today: string): DateRange {
  const until = range.until > today ? today : range.until;
  if (range.since > until) throw new RangeError(`--since ${range.since} is after --until ${until}`);
  return { since: range.since, until };
}

export function toCcusageDate(date: string): string {
  return date.replace(/-/g, '');
}

export function monthsInRange(range: DateRange): string[] {
  const out: string[] = [];
  let { y, m } = parseDate(range.since);
  const end = parseDate(range.until);
  while (y < end.y || (y === end.y && m <= end.m)) {
    out.push(fmt(y, m, 1).slice(0, 7));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export interface MonthBucket extends MonthlyUsage {
  /** Why the month is left out of the evidence, or null when it counts. */
  excluded: 'partial' | 'before-data' | null;
}

export interface BucketOptions {
  minDays: number;
  /** First date with local data on disk, or null when unknown. */
  dataStart: string | null;
}

/**
 * One bucket per calendar month in the range, generated from the calendar and
 * never from the rows, so a month with no data is a zero month rather than a
 * missing one. daysObserved counts days inside [max(since, dataStart), until].
 */
export function bucketMonths(rows: DayCost[], range: DateRange, opts: BucketOptions): MonthBucket[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    if (r.date < range.since || r.date > range.until) continue;
    const ym = r.date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + r.cost);
  }
  return monthsInRange(range).map((ym) => {
    const dim = daysInMonth(ym);
    const first = `${ym}-01`;
    const last = `${ym}-${String(dim).padStart(2, '0')}`;
    let start = range.since > first ? range.since : first;
    if (opts.dataStart && opts.dataStart > start) start = opts.dataStart;
    const end = range.until < last ? range.until : last;
    const daysObserved = start > end ? 0 : daysBetweenInclusive(start, end);
    const beforeData = opts.dataStart !== null && last < opts.dataStart;
    const excluded: MonthBucket['excluded'] = beforeData ? 'before-data' : daysObserved < opts.minDays ? 'partial' : null;
    return { month: ym, amount: byMonth.get(ym) ?? 0, daysObserved, daysInMonth: dim, excluded };
  });
}
