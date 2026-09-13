import { z } from 'zod';
import { appendRecord, readRecords } from './jsonl';

export const alertRecordSchema = z.strictObject({
  firedAt: z.string().datetime(),
  provider: z.string(),
  direction: z.enum(['upgrade', 'downgrade']),
  bestFitPlan: z.string(),
  heldPlan: z.string().nullable(),
  monthsAgreeing: z.number(),
  basedOn: z.array(z.string()),
  message: z.string(),
});

export type AlertRecord = z.infer<typeof alertRecordSchema>;

export async function appendAlert(file: string, record: AlertRecord): Promise<void> {
  await appendRecord(file, alertRecordSchema.parse(record));
}

export async function listAlerts(file: string): Promise<AlertRecord[]> {
  const { records } = await readRecords(file, alertRecordSchema);
  return records.sort((a, b) => a.firedAt.localeCompare(b.firedAt));
}
