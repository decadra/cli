import { z } from 'zod';

/**
 * Shapes of ccusage v20 JSON, validated against real captures in
 * test/fixtures/ccusage. Loose objects: ccusage adds fields between releases
 * and an unknown extra field must not break a report. Claude rows carry
 * `totalCost` and `modelBreakdowns`; Codex totals carry `costUSD`, so rows
 * accept either and `normalize*` below hands one shape to the rest of the code.
 */
const modelBreakdown = z.looseObject({
  modelName: z.string(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheCreationTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  cost: z.number().default(0),
});

/** Codex shape: `models` is an object keyed by model name, entries carry tokens and no cost. */
const modelEntry = z.looseObject({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheCreationTokens: z.number().default(0),
  cacheReadTokens: z.number().default(0),
  reasoningOutputTokens: z.number().optional(),
  isFallback: z.boolean().optional(),
  cost: z.number().optional(),
});

/**
 * ccusage 20.0.20 emits all five on every daily, monthly and session row, for both the
 * claude and codex sources. Defaulting them to 0 turned a shape change into a confident
 * report of no usage, which is the one wrong answer this tool must never give.
 */
const tokenTotals = {
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheCreationTokens: z.number(),
  cacheReadTokens: z.number(),
  totalTokens: z.number(),
};

/** claude rows carry totalCost, codex rows carry costUSD. Every row carries one of them. */
const costFields = {
  totalCost: z.number().optional(),
  costUSD: z.number().optional(),
};

const hasCost = (r: { totalCost?: number | undefined; costUSD?: number | undefined }): boolean =>
  r.totalCost !== undefined || r.costUSD !== undefined;
const COST_REQUIRED = 'row carries neither totalCost nor costUSD';

const modelFields = {
  modelsUsed: z.array(z.string()).default([]),
  modelBreakdowns: z.array(modelBreakdown).default([]),
  models: z.union([z.array(z.union([z.string(), modelBreakdown])), z.record(z.string(), modelEntry)]).optional(),
};

export const dailyRow = z.looseObject({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ...tokenTotals, ...costFields, ...modelFields }).refine(hasCost, COST_REQUIRED);
export const dailyOutput = z.looseObject({ daily: z.array(dailyRow) });

export const monthlyRow = z.looseObject({ month: z.string().regex(/^\d{4}-\d{2}$/), ...tokenTotals, ...costFields, ...modelFields }).refine(hasCost, COST_REQUIRED);
export const monthlyOutput = z.looseObject({ monthly: z.array(monthlyRow) });

export const sessionRow = z.looseObject({
  sessionId: z.string(),
  projectPath: z.string().optional(),
  firstActivity: z.string().optional(),
  lastActivity: z.string(),
  ...tokenTotals,
  ...costFields,
  ...modelFields,
}).refine(hasCost, COST_REQUIRED);
export const sessionOutput = z.looseObject({ sessions: z.array(sessionRow) });

export const blockRow = z.looseObject({
  id: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  actualEndTime: z.string().nullable().optional(),
  isActive: z.boolean(),
  isGap: z.boolean().default(false),
  entries: z.number().default(0),
  costUSD: z.number().default(0),
  totalTokens: z.number().default(0),
  tokenCounts: z
    .looseObject({
      inputTokens: z.number().default(0),
      outputTokens: z.number().default(0),
      cacheCreationInputTokens: z.number().default(0),
      cacheReadInputTokens: z.number().default(0),
    })
    .optional(),
  models: z.array(z.string()).default([]),
});
export const blocksOutput = z.looseObject({ blocks: z.array(blockRow) });

export type DailyRow = z.infer<typeof dailyRow>;
export type SessionRow = z.infer<typeof sessionRow>;
export type BlockRow = z.infer<typeof blockRow>;
export type MonthlyRow = z.infer<typeof monthlyRow>;

export interface ModelUsage {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** null when the vendor reports cost only at row level (Codex). */
  cost: number | null;
  reasoningOutputTokens?: number;
  isFallback?: boolean;
}

export interface NormalizedUsageRow {
  cost: number;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number; total: number };
  models: ModelUsage[];
}

function normalizeRow(r: DailyRow | MonthlyRow | SessionRow): NormalizedUsageRow {
  const breakdowns: ModelUsage[] = r.modelBreakdowns.map((m) => ({ modelName: m.modelName, inputTokens: m.inputTokens, outputTokens: m.outputTokens, cacheCreationTokens: m.cacheCreationTokens, cacheReadTokens: m.cacheReadTokens, cost: m.cost }));
  const modelNames: string[] = [...r.modelsUsed];
  if (!breakdowns.length && r.models) {
    if (Array.isArray(r.models)) {
      for (const m of r.models) {
        if (typeof m === 'string') modelNames.push(m);
        else breakdowns.push({ modelName: m.modelName, inputTokens: m.inputTokens, outputTokens: m.outputTokens, cacheCreationTokens: m.cacheCreationTokens, cacheReadTokens: m.cacheReadTokens, cost: m.cost });
      }
    } else {
      for (const [name, m] of Object.entries(r.models)) {
        const entry: ModelUsage = { modelName: name, inputTokens: m.inputTokens, outputTokens: m.outputTokens, cacheCreationTokens: m.cacheCreationTokens, cacheReadTokens: m.cacheReadTokens, cost: m.cost ?? null };
        if (m.reasoningOutputTokens !== undefined) entry.reasoningOutputTokens = m.reasoningOutputTokens;
        if (m.isFallback !== undefined) entry.isFallback = m.isFallback;
        breakdowns.push(entry);
      }
    }
  }
  const cost = r.totalCost ?? r.costUSD ?? breakdowns.reduce((a, m) => a + (m.cost ?? 0), 0);
  if (!breakdowns.length && modelNames.length) {
    // No per-model split available: attribute the row to its listed models so zero-price detection still names them.
    for (const name of new Set(modelNames)) breakdowns.push({ modelName: name, inputTokens: r.inputTokens, outputTokens: r.outputTokens, cacheCreationTokens: r.cacheCreationTokens, cacheReadTokens: r.cacheReadTokens, cost: null });
  }
  return {
    cost,
    tokens: { input: r.inputTokens, output: r.outputTokens, cacheWrite: r.cacheCreationTokens, cacheRead: r.cacheReadTokens, total: r.totalTokens },
    models: breakdowns,
  };
}

export interface NormalizedDaily extends NormalizedUsageRow {
  date: string;
}
export interface NormalizedSession extends NormalizedUsageRow {
  sessionId: string;
  projectPath: string | null;
  firstActivity: string | null;
  lastActivity: string;
}

export function normalizeDaily(r: DailyRow): NormalizedDaily {
  return { date: r.date, ...normalizeRow(r) };
}

export function normalizeSession(r: SessionRow): NormalizedSession {
  return { sessionId: r.sessionId, projectPath: r.projectPath ?? null, firstActivity: r.firstActivity ?? null, lastActivity: r.lastActivity, ...normalizeRow(r) };
}

/**
 * Models that carried tokens but priced at zero. A stale offline table looks
 * like savings; this is how it is caught. When a vendor reports cost only at
 * row level, the row's cost stands in for every model on it.
 */
export function zeroPricedModels(rows: Array<{ cost: number; models: ModelUsage[] }>): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    for (const m of r.models) {
      const tokens = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens;
      const cost = m.cost ?? r.cost;
      if (tokens > 0 && cost === 0) out.add(m.modelName);
    }
  }
  return [...out].sort();
}
