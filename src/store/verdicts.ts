import { z } from 'zod';
import { appendRecord, readRecords } from './jsonl';

export const verdictRecordSchema = z.strictObject({
  recordedAt: z.string().datetime(),
  window: z.strictObject({ since: z.string(), until: z.string(), months: z.number().optional() }),
  plansAsOf: z.string(),
  provider: z.string(),
  heldPlan: z.string().nullable(),
  heldPlanName: z.string().nullable().optional(),
  bestFitPlan: z.string().nullable(),
  bestFitPlanName: z.string().nullable().optional(),
  direction: z.enum(['upgrade', 'downgrade', 'hold', 'unknown']),
  monthsOfEvidence: z.number(),
  evidence: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type VerdictRecord = z.infer<typeof verdictRecordSchema>;

export async function appendVerdict(file: string, record: VerdictRecord): Promise<void> {
  await appendRecord(file, verdictRecordSchema.parse(record));
}

export async function lastVerdict(file: string, provider: string): Promise<VerdictRecord | null> {
  const { records } = await readRecords(file, verdictRecordSchema);
  let best: VerdictRecord | null = null;
  for (const r of records) if (r.provider === provider && (!best || r.recordedAt > best.recordedAt)) best = r;
  return best;
}
