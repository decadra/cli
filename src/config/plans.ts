import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DecadraPaths } from './paths';

export const PLANS_SCHEMA_VERSION = 2;

const meterUnit = z.enum(['usd-list', 'usd-billed', 'acu']);

const usageSource = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('ccusage'), source: z.string().min(1) }),
  z.strictObject({ kind: z.literal('native') }),
  z.strictObject({ kind: z.literal('import'), format: z.string().min(1) }),
  z.strictObject({ kind: z.literal('manual') }),
]);

const tokenPricing = z.strictObject({
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
  cacheWrite: z.number().nonnegative().optional(),
  cacheRead: z.number().nonnegative().optional(),
});

const allowance = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('capped-window'),
    multiplierVsBase: z.number().positive(),
  }),
  z.strictObject({
    kind: z.literal('included-credit'),
    unit: meterUnit,
    amount: z.number().nonnegative(),
    overageUsdPerUnit: z.number().nonnegative(),
  }),
  z.strictObject({
    kind: z.literal('metered'),
    unit: meterUnit,
    usdPerUnit: z.number().nonnegative().optional(),
    minimumUsd: z.number().nonnegative().optional(),
    tokenPricing: tokenPricing.optional(),
  }),
]);

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const plan = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'plan ids are lowercase kebab-case'),
  name: z.string().min(1),
  monthlyUsd: z.number().nonnegative(),
  allowance,
  asOf: isoDate,
  source: z.string().optional(),
  notes: z.string().optional(),
});

const window = z.strictObject({
  kind: z.enum(['short', 'weekly']),
  hours: z.number().positive(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.optional(),
});

const providerPlans = z.strictObject({
  '//': z.string().optional(),
  displayName: z.string().min(1),
  meter: meterUnit,
  ingest: usageSource.optional(),
  basePlan: z.string().optional(),
  windows: z.array(window).default([]),
  anchorApiEquivalentUsd: z
    .strictObject({ short: z.number().nullable(), weekly: z.number().nullable() })
    .optional(),
  plans: z.array(plan).min(1),
});

const modelPrice = z.strictObject({
  input: z.number().nullable(),
  output: z.number().nullable(),
  cacheWrite: z.number().nullable(),
  cacheRead: z.number().nullable(),
});

export const plansFileSchema = z.strictObject({
  $schema: z.string().optional(),
  schemaVersion: z.literal(PLANS_SCHEMA_VERSION),
  asOf: isoDate,
  currency: z.literal('USD'),
  '//': z.string().optional(),
  providers: z.record(z.string().regex(/^[a-z0-9][a-z0-9-]*$/), providerPlans),
  modelPricing: z.record(z.string(), modelPrice),
});

export type ModelPrice = z.infer<typeof modelPrice>;
export type PlansFile = z.infer<typeof plansFileSchema>;

/**
 * Bands for a hand-maintained price, expressed against that model's own input price so they hold
 * whatever the currency scale. Vendors publish cache read near a tenth of input, and a cache write
 * at 1.25x input for a 5-minute TTL or 2x for an hour. The bands are wide because these are other
 * people's prices and they move; they are here to catch a rate wrong by a factor, not to police
 * a vendor's rounding. Every finding is a warning, never a failure.
 */
export const CACHE_WRITE_TTL_RATIOS = { fiveMinutes: 1.25, oneHour: 2 } as const;

const RATIO_BANDS = {
  cacheRead: { low: 0.05, high: 0.5, published: 'near 0.1x input' },
  cacheWrite: { low: 1.0, high: 2.5, published: '1.25x input for a 5-minute TTL, 2x for an hour' },
} as const;

export interface PriceRatioIssue {
  model: string;
  field: 'cacheRead' | 'cacheWrite';
  ratio: number;
  message: string;
}

/**
 * Prices in plans.json are typed by hand and nothing else checks them: the schema takes any
 * number, and a rate wrong by 4x still produces a nonzero cost, so the zero-price check never
 * fires on it. Compares each cache rate to the model's input rate and reports the ones that sit
 * outside what any vendor publishes. Pure.
 */
export function priceRatioIssues(modelPricing: Record<string, ModelPrice>): PriceRatioIssue[] {
  const issues: PriceRatioIssue[] = [];
  for (const [model, p] of Object.entries(modelPricing)) {
    if (typeof p.input !== 'number' || p.input <= 0) continue;
    for (const field of ['cacheRead', 'cacheWrite'] as const) {
      const price = p[field];
      if (typeof price !== 'number' || price < 0) continue;
      const ratio = price / p.input;
      const band = RATIO_BANDS[field];
      if (ratio >= band.low && ratio <= band.high) continue;
      issues.push({ model, field, ratio, message: `${model} ${field} is ${ratio.toFixed(3)}x its input price; published rates sit ${band.published}` });
    }
  }
  return issues.sort((a, b) => a.model.localeCompare(b.model) || a.field.localeCompare(b.field));
}
export type ProviderPlans = z.infer<typeof providerPlans>;
export type Plan = z.infer<typeof plan>;
export type Allowance = z.infer<typeof allowance>;
export type MeterUnit = z.infer<typeof meterUnit>;
export type UsageSourceConfig = z.infer<typeof usageSource>;

const ASOF = '2026-09-05';

/**
 * Scaffolded content. Every number here is hand-maintained and dated.
 * Ceilings for Anthropic and OpenAI are unpublished; only multipliers are stated.
 */
export function defaultPlans(): PlansFile {
  return {
    $schema: './plans.schema.json',
    schemaVersion: PLANS_SCHEMA_VERSION,
    asOf: ASOF,
    currency: 'USD',
    '//':
      'Hand-maintained. Prices change without notice; update asOf when you touch a number. ' +
      'Ceilings for capped-window plans are unpublished: multiplierVsBase is the vendor stated multiple. ' +
      'Fill anchorApiEquivalentUsd with your own estimate of the base plan allowance to get a reference line, or leave null.',
    providers: {
      'anthropic-claude-code': {
        displayName: 'Claude',
        meter: 'usd-list',
        ingest: { kind: 'ccusage', source: 'claude' },
        basePlan: 'pro',
        windows: [
          { kind: 'short', hours: 5, effectiveFrom: '2025-01-01' },
          { kind: 'weekly', hours: 168, effectiveFrom: '2025-08-28' },
        ],
        anchorApiEquivalentUsd: { short: null, weekly: null },
        plans: [
          { id: 'pro', name: 'Pro', monthlyUsd: 20, allowance: { kind: 'capped-window', multiplierVsBase: 1 }, asOf: ASOF },
          { id: 'max5', name: 'Max 5x', monthlyUsd: 100, allowance: { kind: 'capped-window', multiplierVsBase: 5 }, asOf: ASOF },
          { id: 'max20', name: 'Max 20x', monthlyUsd: 200, allowance: { kind: 'capped-window', multiplierVsBase: 20 }, asOf: ASOF },
        ],
      },
      'openai-codex': {
        displayName: 'ChatGPT',
        meter: 'usd-list',
        ingest: { kind: 'ccusage', source: 'codex' },
        basePlan: 'plus',
        windows: [
          // Verified against real 0.144.6 rollouts on 2026-09-06: rate_limits.primary
          // reports window_minutes 300 again, with the weekly window as secondary. The
          // short window had been recorded as ending on 2026-07-12; it did not.
          { kind: 'short', hours: 5, effectiveFrom: '2025-01-01' },
          { kind: 'weekly', hours: 168, effectiveFrom: '2025-01-01' },
        ],
        anchorApiEquivalentUsd: { short: null, weekly: null },
        plans: [
          { id: 'plus', name: 'Plus', monthlyUsd: 20, allowance: { kind: 'capped-window', multiplierVsBase: 1 }, asOf: ASOF },
          { id: 'pro', name: 'Pro', monthlyUsd: 100, allowance: { kind: 'capped-window', multiplierVsBase: 5 }, asOf: ASOF },
          { id: 'pro20', name: 'Pro 20x', monthlyUsd: 200, allowance: { kind: 'capped-window', multiplierVsBase: 20 }, asOf: ASOF },
        ],
      },
      cursor: {
        '//': 'Included usage is a dollar pool at Cursor model prices. The official CSV export is the source of truth for the unit.',
        displayName: 'Cursor',
        meter: 'usd-billed',
        ingest: { kind: 'import', format: 'cursor-csv' },
        windows: [],
        plans: [
          { id: 'pro', name: 'Pro', monthlyUsd: 20, allowance: { kind: 'included-credit', unit: 'usd-billed', amount: 20, overageUsdPerUnit: 1 }, asOf: ASOF },
          { id: 'pro-plus', name: 'Pro+', monthlyUsd: 60, allowance: { kind: 'included-credit', unit: 'usd-billed', amount: 70, overageUsdPerUnit: 1 }, asOf: ASOF },
          { id: 'ultra', name: 'Ultra', monthlyUsd: 200, allowance: { kind: 'included-credit', unit: 'usd-billed', amount: 400, overageUsdPerUnit: 1 }, asOf: ASOF },
        ],
      },
      devin: {
        '//': 'Unit is the ACU. Core is pay as you go with a $20 entry; Team includes 250 ACUs.',
        displayName: 'Devin',
        meter: 'acu',
        ingest: { kind: 'native' },
        windows: [],
        plans: [
          { id: 'core', name: 'Core', monthlyUsd: 0, allowance: { kind: 'metered', unit: 'acu', usdPerUnit: 2.25, minimumUsd: 20 }, asOf: ASOF },
          { id: 'team', name: 'Team', monthlyUsd: 500, allowance: { kind: 'included-credit', unit: 'acu', amount: 250, overageUsdPerUnit: 2.0 }, asOf: ASOF },
        ],
      },
      'meta-muse': {
        '//': 'No subscription and no cap. Tiers are per-million-token prices. Contributor tier trains on your data.',
        displayName: 'Muse Code',
        meter: 'usd-list',
        ingest: { kind: 'native' },
        windows: [],
        plans: [
          { id: 'standard', name: 'Standard', monthlyUsd: 0, allowance: { kind: 'metered', unit: 'usd-list', tokenPricing: { input: 1.25, output: 4.25 } }, asOf: ASOF },
          { id: 'contributor', name: 'Contributor', monthlyUsd: 0, allowance: { kind: 'metered', unit: 'usd-list', tokenPricing: { input: 0.1, output: 0.2 } }, asOf: ASOF, notes: 'Meta trains on inputs and outputs. 100 requests per minute.' },
        ],
      },
    },
    modelPricing: {},
  };
}

export class PlansError extends Error {
  constructor(message: string, readonly path: string) {
    super(message);
    this.name = 'PlansError';
  }
}

export function formatIssues(err: z.ZodError): string {
  return err.issues
    .map((issue) => `  at ${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('\n');
}

function shippedSchemaPath(): string {
  // schema/plans.schema.json ships in the package next to dist/.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, '..', 'schema', 'plans.schema.json'), join(here, '..', '..', 'schema', 'plans.schema.json')];
  for (const c of candidates) if (existsSync(c)) return c;
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('../../package.json')), 'schema', 'plans.schema.json');
}

/** Creates plans.json and its schema copy only when missing. Never overwrites. */
export async function ensurePlans(paths: DecadraPaths): Promise<{ created: boolean }> {
  if (existsSync(paths.plans)) return { created: false };
  await writeFile(paths.plans, JSON.stringify(defaultPlans(), null, 2) + '\n', { flag: 'wx' });
  try {
    await copyFile(shippedSchemaPath(), paths.plansSchema);
  } catch {
    // The schema copy is a convenience for editors; its absence is reported by doctor.
  }
  return { created: true };
}

export async function loadPlans(paths: DecadraPaths): Promise<PlansFile> {
  let raw: string;
  try {
    raw = await readFile(paths.plans, 'utf8');
  } catch {
    throw new PlansError(`plans.json not found at ${paths.plans}. Run any command once to create it.`, paths.plans);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new PlansError(`plans.json is not valid JSON: ${(e as Error).message}`, paths.plans);
  }
  const result = plansFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new PlansError(`plans.json failed validation:\n${formatIssues(result.error)}`, paths.plans);
  }
  return result.data;
}

export function jsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(plansFileSchema, { target: 'draft-7' }) as Record<string, unknown>;
}
