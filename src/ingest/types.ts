/** Normalized records every provider reader emits. No prompt text, no free text longer than a path. */
export type ProviderId = string;

export interface SessionRecord {
  provider: ProviderId;
  sessionId: string;
  cwd: string | null;
  cwds: string[];
  firstTs: string;
  lastTs: string;
  /** Wall-clock minutes between first and last line. */
  wallMinutes: number;
  /** Sum of gaps between consecutive lines, each capped at the idle gap. */
  activeMinutes: number;
  humanTurns: number;
  assistantMessages: number;
  toolCalls: number;
  commitCommandsInTranscript: number;
  models: string[];
  /**
   * The effort or reasoning levels the session ran at, as the tool named them, sorted.
   * Kept verbatim per provider and never mapped onto another provider's scale: the
   * vocabularies differ and one vendor's "high" is not another's.
   */
  efforts: string[];
  /**
   * How large the model's input grew. Context is re-read on every reply, so a long session
   * costs multiples of what it cost at its first turn. Null where the tool writes nothing
   * to measure it from: zero would be a claim, null is the absence of one.
   */
  contextPeakTokens: number | null;
  /** The input size at the session's first measured step. */
  contextFloorTokens: number | null;
  /** The model's context window, where the tool states it. Gives peak a denominator. */
  contextWindowTokens: number | null;
  /**
   * Cache-creation tokens split by the TTL the tool asked for. The vendor prices a 1-hour write
   * above a 5-minute one, but ccusage holds a single cache-creation rate per model, so the split
   * is what says whether that one rate fits the work. Null where the tool states no split.
   */
  cacheWrite1hTokens: number | null;
  cacheWrite5mTokens: number | null;
  toolVersion: string | null;
  durationQuality: 'exact' | 'coarse';
}

/** A utilization figure the tool itself wrote, such as Codex rate_limits. */
export interface UtilizationSample {
  provider: ProviderId;
  ts: string;
  windowMinutes: number | null;
  usedPercent: number;
  planType: string | null;
}

export type UsageFigureSource = 'ccusage' | 'native' | 'import' | 'manual' | 'list-estimate';

export interface UsageEvent {
  provider: ProviderId;
  ts: string;
  sessionId: string | null;
  model: string | null;
  tokens?: { input: number; output: number; cacheWrite: number; cacheRead: number };
  units?: { unit: 'acu' | 'usd-billed'; amount: number };
  source: UsageFigureSource;
}
