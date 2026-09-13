import { z } from 'zod';

export const nowSectionSchema = z.strictObject({
  meter: z.enum(['usd-list', 'usd-billed', 'acu']),
  source: z.enum(['ccusage', 'none']),
  detected: z.boolean(),
  held: z.strictObject({ planId: z.string().nullable(), name: z.string().nullable(), monthlyUsd: z.number().nullable(), asOf: z.string().nullable() }),
  session: z
    .strictObject({
      sessionId: z.string(),
      cost: z.number().nullable(),
      minutes: z.number().nullable(),
      quality: z.enum(['exact', 'coarse']),
    })
    .nullable(),
  today: z.number().nullable(),
  monthToDate: z.number().nullable(),
  monthMultiple: z.number().nullable(),
  daysObserved: z.number(),
  daysInMonth: z.number(),
  projectedMonth: z.number().nullable(),
  ceiling: z.string(),
  lastVerdict: z.strictObject({ direction: z.string(), confidence: z.string(), recordedAt: z.string() }).nullable(),
  zeroPricedModels: z.array(z.string()),
  error: z.string().nullable(),
  elapsedMs: z.number(),
});

export type NowSection = z.infer<typeof nowSectionSchema>;
