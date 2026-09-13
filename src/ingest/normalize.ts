import type { SessionRecord } from './types';

/**
 * What a reader accumulates while scanning one transcript. Readers fill this
 * and call finalize; the arithmetic lives here so every provider does it the
 * same way and readers stay under budget.
 */
export interface RawSession {
  provider: string;
  sessionId: string;
  cwds: Map<string, number>;
  timestamps: number[];
  humanTurns: number;
  assistantIds: Set<string>;
  toolCalls: number;
  commitCommands: number;
  models: Set<string>;
  efforts: Set<string>;
  contextSteps: number[];
  contextWindow: number | null;
  cacheWrite1h: number | null;
  cacheWrite5m: number | null;
  toolVersion: string | null;
  quality: 'exact' | 'coarse';
}

export function newRaw(provider: string, sessionId: string, quality: 'exact' | 'coarse' = 'exact'): RawSession {
  return { provider, sessionId, cwds: new Map(), timestamps: [], humanTurns: 0, assistantIds: new Set(), toolCalls: 0, commitCommands: 0, models: new Set(), efforts: new Set(), contextSteps: [], contextWindow: null, cacheWrite1h: null, cacheWrite5m: null, toolVersion: null, quality };
}

export const GIT_COMMIT = /\bgit\b[^\n|;&]*\bcommit\b/;

export function noteCwd(raw: RawSession, cwd: unknown): void {
  if (typeof cwd === 'string' && cwd) raw.cwds.set(cwd, (raw.cwds.get(cwd) ?? 0) + 1);
}

/**
 * An effort label is a short token the vendor chose, not free text. Observed values across
 * two tools include low, medium, high, xhigh, max, ultra and banana, so this is bounded by
 * shape rather than by a list: a closed enum would drop a level the day a vendor adds one.
 */
const EFFORT_LABEL = /^[a-z0-9][a-z0-9_-]{0,23}$/i;

export function noteEffort(raw: RawSession, effort: unknown): void {
  if (typeof effort === 'string' && EFFORT_LABEL.test(effort)) raw.efforts.add(effort);
}

/**
 * One measurement of how much input the model read for a single reply. Zero and negative
 * values are dropped: a record that stands in for a reply that never came reports zero, and
 * counting it would drag a floor to nothing.
 */
export function noteContext(raw: RawSession, tokens: unknown): void {
  if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) raw.contextSteps.push(tokens);
}

/**
 * How much of the cache this session wrote at each TTL. The vendor charges the two differently,
 * but ccusage holds one cache-creation rate per model and applies it to both, so which TTL a
 * session actually uses decides whether that single rate is the right one. Null until a record
 * states a split, because zero would be a claim that none was written. Nothing here is priced.
 */
export function noteCacheWriteTtl(raw: RawSession, oneHour: unknown, fiveMinutes: unknown): void {
  const add = (current: number | null, v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? (current ?? 0) + v : current;
  raw.cacheWrite1h = add(raw.cacheWrite1h, oneHour);
  raw.cacheWrite5m = add(raw.cacheWrite5m, fiveMinutes);
}

export function noteContextWindow(raw: RawSession, tokens: unknown): void {
  if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) raw.contextWindow = tokens;
}

export function noteTs(raw: RawSession, ts: unknown): void {
  if (typeof ts !== 'string') return;
  const ms = Date.parse(ts);
  if (Number.isFinite(ms)) raw.timestamps.push(ms);
}

export function finalize(raw: RawSession, idleGapMinutes: number): SessionRecord | null {
  if (!raw.timestamps.length) return null;
  const ts = [...raw.timestamps].sort((a, b) => a - b);
  const first = ts[0] as number;
  const last = ts[ts.length - 1] as number;
  const cap = idleGapMinutes * 60_000;
  let active = 0;
  for (let i = 1; i < ts.length; i += 1) active += Math.min(cap, (ts[i] as number) - (ts[i - 1] as number));
  const cwds = [...raw.cwds.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return {
    provider: raw.provider,
    sessionId: raw.sessionId,
    cwd: cwds[0] ?? null,
    cwds,
    firstTs: new Date(first).toISOString(),
    lastTs: new Date(last).toISOString(),
    wallMinutes: Math.round((last - first) / 60_000),
    activeMinutes: Math.round(active / 60_000),
    humanTurns: raw.humanTurns,
    assistantMessages: raw.assistantIds.size,
    toolCalls: raw.toolCalls,
    commitCommandsInTranscript: raw.commitCommands,
    models: [...raw.models].sort(),
    efforts: [...raw.efforts].sort(),
    contextPeakTokens: raw.contextSteps.length ? Math.max(...raw.contextSteps) : null,
    contextFloorTokens: raw.contextSteps[0] ?? null,
    contextWindowTokens: raw.contextWindow,
    cacheWrite1hTokens: raw.cacheWrite1h,
    cacheWrite5mTokens: raw.cacheWrite5m,
    toolVersion: raw.toolVersion,
    durationQuality: raw.quality,
  };
}

/** Reads a JSONL file line by line, skipping lines that are not JSON objects. */
export async function* jsonLines(file: string): AsyncGenerator<Record<string, unknown>> {
  const { createReadStream } = await import('node:fs');
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) yield v as Record<string, unknown>;
    } catch {
      // malformed line: skip, never throw
    }
  }
}
