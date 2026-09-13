import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { DecadraPaths } from './paths';
import { formatIssues } from './plans';

export const settingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  /** Tolerated and ignored here. Carried so settings written elsewhere still validate. */
  routing: z.unknown().optional(),
  idleGapMinutes: z.number().positive().default(30),
  commitWindowMinutes: z.number().nonnegative().default(30),
  ccusageBin: z.string().nullable().default(null),
  ui: z.strictObject({ animation: z.boolean().default(true) }).default({ animation: true }),
  alerts: z
    .strictObject({
      consecutiveMonths: z.number().int().positive().default(2),
      minDays: z.number().int().positive().default(30),
    })
    .default({ consecutiveMonths: 2, minDays: 30 }),
  devin: z.strictObject({ acuUsdRateOverride: z.number().nullable().default(null) }).default({ acuUsdRateOverride: null }),
  /** When setup was last offered or run. Set so the first-run offer is made once, not every run. */
  setupOfferedAt: z.string().nullable().default(null),
  providers: z
    .strictObject({
      /**
       * Which providers the reporting commands cover. 'auto' is the ones you pay for and the
       * ones you demonstrably use; a list names them outright. `doctor` ignores this and
       * always reports on every provider, because surveying the machine is its job.
       */
      show: z.union([z.literal('auto'), z.array(z.string().min(1))]).default('auto'),
    })
    .default({ show: 'auto' }),
});

export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(): Settings {
  return settingsSchema.parse({ schemaVersion: 1 });
}

export async function ensureSettings(paths: DecadraPaths): Promise<{ created: boolean }> {
  if (existsSync(paths.settings)) return { created: false };
  await writeFile(paths.settings, JSON.stringify(defaultSettings(), null, 2) + '\n', { flag: 'wx' });
  return { created: true };
}

/**
 * Merge a change into settings.json and write it back whole.
 *
 * `ensureSettings` cannot be reused: its `wx` flag exists to refuse exactly this, so that a
 * first run never clobbers a file someone hand-wrote. This reads what is there, applies the
 * patch over it, and keeps every key it did not touch.
 */
export async function updateSettings(paths: DecadraPaths, patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings(paths);
  const next = settingsSchema.parse({ ...current, ...patch });
  await writeFile(paths.settings, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export async function loadSettings(paths: DecadraPaths): Promise<Settings> {
  if (!existsSync(paths.settings)) return defaultSettings();
  const parsed = JSON.parse(await readFile(paths.settings, 'utf8')) as unknown;
  const result = settingsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`settings.json failed validation:\n${formatIssues(result.error)}`);
  }
  return result.data;
}
