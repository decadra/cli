import type { SessionRecord } from '../ingest/types';
import { median } from './planfit';

/** Effort read per provider. Pure over normalized records plus per-session commit signals. */
export interface CommitSignals {
  sessionId: string;
  repo: 'ok' | 'missing' | 'not-a-repo' | 'error' | 'unknown-cwd';
  commitsInWindow: number;
  coAuthorTrailers: number;
}

export interface EffortSummary {
  sessions: number;
  turns: { median: number; p90: number };
  wallMinutes: { median: number; p90: number };
  activeMinutes: { median: number; p90: number };
  toolCalls: { median: number; p90: number };
  /** Share of sessions with a git commit call in the transcript. Primary commit signal. */
  commitCommandShare: number;
  /** Among sessions whose cwd is a git repo: share with at least one commit in [first, last + N]. Secondary, weak. */
  commitWindowShare: number | null;
  /** Among sessions whose cwd is a git repo: share with a commit carrying a Claude co-author trailer. */
  coAuthorShare: number | null;
  repoSessions: number;
  cwdUnknownOrMissing: number;
  coarseDurations: number;
  /** Sessions that ran at each label, most first. A session can use more than one, so these do not sum to the session count. */
  effortMix: Array<{ effort: string; sessions: number }>;
  /** Sessions where the tool recorded no effort at all. */
  effortUnrecorded: number;
  /** Peak input tokens per reply, over sessions where the tool wrote enough to measure it. */
  contextPeak: { median: number; p90: number } | null;
  /**
   * Peak input tokens divided by assistant replies. Replies, not human turns: fan-out runs from
   * under 6 to over 30 replies per turn, so dividing by turns measures how far the tool ran
   * unattended rather than how much context each reply carried.
   */
  contextPerReply: { median: number; p90: number } | null;
  /** How many sessions carried a context measurement at all. */
  contextSessions: number;
  /**
   * Cache-creation tokens by TTL, summed over the sessions that state a split. The vendor prices
   * the two differently while ccusage holds one cache-creation rate, so this is what says which
   * rate fits. Null when no session stated a split.
   */
  cacheWriteTtl: { oneHour: number; fiveMinutes: number } | null;
}

export function p90(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(0.9 * s.length) - 1))] as number;
}

const stat = (v: number[]): { median: number; p90: number } => ({ median: median(v), p90: p90(v) });

/** Labels are kept as each tool wrote them; nothing is mapped onto another provider's scale. */
function effortMix(records: SessionRecord[]): Array<{ effort: string; sessions: number }> {
  const counts = new Map<string, number>();
  for (const r of records) for (const e of r.efforts) counts.set(e, (counts.get(e) ?? 0) + 1);
  return [...counts]
    .map(([effort, sessions]) => ({ effort, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.effort.localeCompare(b.effort));
}

export function summarizeEffort(records: SessionRecord[], signals: CommitSignals[]): EffortSummary {
  const byId = new Map(signals.map((s) => [s.sessionId, s]));
  const repo = records.filter((r) => byId.get(r.sessionId)?.repo === 'ok');
  const withContext = records.filter((r) => r.contextPeakTokens !== null);
  const perReply = withContext.filter((r) => r.assistantMessages > 0).map((r) => Math.round((r.contextPeakTokens as number) / r.assistantMessages));
  const share = (n: number, d: number): number | null => (d ? n / d : null);
  const withTtl = records.filter((r) => r.cacheWrite1hTokens !== null || r.cacheWrite5mTokens !== null);
  const sum = (pick: (r: SessionRecord) => number | null): number => withTtl.reduce((t, r) => t + (pick(r) ?? 0), 0);
  return {
    sessions: records.length,
    turns: stat(records.map((r) => r.humanTurns)),
    wallMinutes: stat(records.map((r) => r.wallMinutes)),
    activeMinutes: stat(records.map((r) => r.activeMinutes)),
    toolCalls: stat(records.map((r) => r.toolCalls)),
    commitCommandShare: records.length ? records.filter((r) => r.commitCommandsInTranscript > 0).length / records.length : 0,
    commitWindowShare: share(repo.filter((r) => (byId.get(r.sessionId)?.commitsInWindow ?? 0) > 0).length, repo.length),
    coAuthorShare: share(repo.filter((r) => (byId.get(r.sessionId)?.coAuthorTrailers ?? 0) > 0).length, repo.length),
    repoSessions: repo.length,
    cwdUnknownOrMissing: records.filter((r) => byId.get(r.sessionId)?.repo !== 'ok').length,
    coarseDurations: records.filter((r) => r.durationQuality === 'coarse').length,
    effortMix: effortMix(records),
    effortUnrecorded: records.filter((r) => !r.efforts.length).length,
    contextPeak: withContext.length ? stat(withContext.map((r) => r.contextPeakTokens as number)) : null,
    contextPerReply: perReply.length ? stat(perReply) : null,
    contextSessions: withContext.length,
    cacheWriteTtl: withTtl.length ? { oneHour: sum((r) => r.cacheWrite1hTokens), fiveMinutes: sum((r) => r.cacheWrite5mTokens) } : null,
  };
}
