import { z } from 'zod';

const verdict = z.strictObject({
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

export const assessSectionSchema = z.strictObject({
  meter: z.enum(['usd-list', 'usd-billed', 'acu']),
  source: z.enum(['ccusage', 'none']),
  window: z.strictObject({ since: z.string(), until: z.string() }),
  months: z.array(
    z.strictObject({
      month: z.string(),
      amount: z.number(),
      daysObserved: z.number(),
      daysInMonth: z.number(),
      excluded: z.enum(['partial', 'before-data']).nullable(),
    }),
  ),
  windowPeaks: z.array(z.strictObject({ kind: z.enum(['short', 'weekly']), max: z.number(), p95: z.number(), p50: z.number().optional() })),
  rows: z.array(
    z.strictObject({
      planId: z.string(),
      name: z.string(),
      monthlyUsd: z.number(),
      effectiveUsdPerMonth: z.number().nullable(),
      multiple: z.number().nullable(),
      fits: z.boolean().nullable(),
      fitsBasis: z.enum(['anchor', 'recorded', 'none', 'not-capped']),
      notes: z.array(z.string()),
    }),
  ),
  verdict,
  zeroPricedModels: z.array(z.string()),
  dataStart: z.string().nullable(),
  heldPlanChanges: z.array(z.string()),
  error: z.string().nullable(),
});

export type AssessSection = z.infer<typeof assessSectionSchema>;
