import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { appendRecord, readRecords } from './jsonl';

export const baselineRecordSchema = z.strictObject({
  id: z.string().min(8),
  recordedAt: z.string().datetime(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.string().min(1),
  product: z.string().min(1),
  tier: z.string().nullable(),
  price: z.number().nonnegative(),
  currency: z.string().length(3),
  billing: z.enum(['monthly', 'annual']),
  note: z.string().optional(),
  supersedes: z.string().optional(),
});

export type BaselineRecord = z.infer<typeof baselineRecordSchema>;
export type BaselineInput = Omit<BaselineRecord, 'id' | 'recordedAt'>;

export class DuplicateBaselineError extends Error {
  constructor(readonly existing: BaselineRecord) {
    super(`an identical snapshot already exists (id ${existing.id}, recorded ${existing.recordedAt}). Use --force to append anyway.`);
    this.name = 'DuplicateBaselineError';
  }
}

export function newId(): string {
  return randomBytes(6).toString('hex');
}

export async function listBaseline(file: string): Promise<{ records: BaselineRecord[]; malformed: number }> {
  const { records, malformed } = await readRecords(file, baselineRecordSchema);
  records.sort((a, b) => (a.asOf === b.asOf ? b.recordedAt.localeCompare(a.recordedAt) : b.asOf.localeCompare(a.asOf)));
  return { records, malformed };
}

export function isDuplicate(a: BaselineInput, b: BaselineRecord): boolean {
  return a.provider === b.provider && a.product === b.product && a.tier === b.tier && a.price === b.price && a.asOf === b.asOf && a.currency === b.currency && a.billing === b.billing;
}

export async function addBaseline(file: string, input: BaselineInput, opts: { force?: boolean } = {}): Promise<BaselineRecord> {
  const { records } = await listBaseline(file);
  if (!opts.force) {
    const dup = records.find((r) => isDuplicate(input, r));
    if (dup) throw new DuplicateBaselineError(dup);
  }
  if (input.supersedes && !records.some((r) => r.id === input.supersedes)) {
    throw new Error(`supersedes ${input.supersedes}: no snapshot with that id`);
  }
  const record: BaselineRecord = baselineRecordSchema.parse({ id: newId(), recordedAt: new Date().toISOString(), ...input });
  await appendRecord(file, record);
  return record;
}

/** Latest snapshot per provider, ignoring superseded records. */
export function currentByProvider(records: BaselineRecord[]): Map<string, BaselineRecord> {
  const superseded = new Set(records.map((r) => r.supersedes).filter((s): s is string => Boolean(s)));
  const out = new Map<string, BaselineRecord>();
  for (const r of records) {
    if (superseded.has(r.id)) continue;
    if (!out.has(r.provider)) out.set(r.provider, r);
  }
  return out;
}

/** Plan held on a date: latest non-superseded snapshot with asOf on or before it. */
export function heldOn(records: BaselineRecord[], provider: string, date: string): BaselineRecord | null {
  const superseded = new Set(records.map((r) => r.supersedes).filter((x): x is string => Boolean(x)));
  let best: BaselineRecord | null = null;
  for (const r of records) {
    if (r.provider !== provider || superseded.has(r.id) || r.asOf > date) continue;
    if (!best || r.asOf > best.asOf || (r.asOf === best.asOf && r.recordedAt > best.recordedAt)) best = r;
  }
  return best;
}

export interface HeldSpan {
  month: string;
  planId: string | null;
  days: number;
}

/**
 * For each month, which plan was held for how many days inside the window. Splits a month
 * when the plan changed inside it. Counting from day 1 regardless of the window would bill
 * a mid-month `--since` for days the window never covered.
 */
export function heldByMonth(records: BaselineRecord[], provider: string, months: Array<{ month: string; daysInMonth: number }>, since: string, until: string): HeldSpan[] {
  const out: HeldSpan[] = [];
  for (const m of months) {
    const counts = new Map<string | null, number>();
    for (let d = 1; d <= m.daysInMonth; d += 1) {
      const date = `${m.month}-${String(d).padStart(2, '0')}`;
      if (date < since) continue;
      if (date > until) break;
      const tier = heldOn(records, provider, date)?.tier ?? null;
      counts.set(tier, (counts.get(tier) ?? 0) + 1);
    }
    for (const [planId, days] of counts) if (days > 0) out.push({ month: m.month, planId, days });
  }
  return out;
}

/** Sum of subscription prices held on a date, normalized to monthly. Prices only, never usage. */
export function billTotal(records: BaselineRecord[], date: string): { monthlyUsd: number; count: number; asOf: string } | null {
  const providers = new Set(records.map((r) => r.provider));
  let total = 0;
  let count = 0;
  let asOf = '';
  for (const p of providers) {
    const r = heldOn(records, p, date);
    if (!r || r.currency !== 'USD') continue;
    total += r.billing === 'annual' ? r.price / 12 : r.price;
    count += 1;
    if (r.asOf > asOf) asOf = r.asOf;
  }
  return count ? { monthlyUsd: total, count, asOf } : null;
}
