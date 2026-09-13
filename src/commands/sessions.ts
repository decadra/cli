import { writeFile } from 'node:fs/promises';
import { ensureRoot } from '../config/paths';
import { ensurePlans, loadPlans } from '../config/plans';
import { loadSettings } from '../config/settings';
import { todayUtc } from '../analysis/months';
import { formatMinutes } from '../analysis/units';
import { summarizeEffort, type CommitSignals } from '../analysis/effort';
import { commitsInWindow } from '../git/commits';
import type { SessionRecord } from '../ingest/types';
import { hiddenNote, resolveAdapters, visibleProviders } from '../providers/registry';
import { listBaseline } from '../store/baseline';
import type { ProviderAdapter } from '../providers/types';
import { CAVEATS, emptyReport, type Block, type ProviderSection, type Report } from '../report/model';
import { renderReport } from '../report/render';
import { resolveWindow, type AssessOptions } from './assess';
import { CliError, type CommandContext } from './context';
import { defaultDeps, type CommandDeps } from './deps';
import { sessionsSectionSchema, type SessionsSection } from './sessions.schema';

export type SessionsOptions = AssessOptions;

const pct = (v: number | null): string => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const ms = (s: { median: number; p90: number }): string => `median ${s.median}, p90 ${s.p90}`;
/** The same pair as a duration, since minutes past an hour or two stop meaning anything. */
const mins = (s: { median: number; p90: number }): string => `median ${formatMinutes(s.median)}, p90 ${formatMinutes(s.p90)}`;
/** Token counts run to hundreds of thousands; full digits make a table unreadable. */
const tokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

/**
 * Reads as a share because the share is the decision: the price entered for a model is charged
 * to every cache write whatever its TTL, so the TTL the work actually uses is the one to price.
 */
function cacheWriteTtlLine(ttl: { oneHour: number; fiveMinutes: number }): string {
  const total = ttl.oneHour + ttl.fiveMinutes;
  if (!total) return 'no split stated';
  return `${tokens(total)}, ${Math.round((ttl.oneHour / total) * 100)}% written for 1 hour, ${Math.round((ttl.fiveMinutes / total) * 100)}% for 5 minutes`;
}

/**
 * Commit signals per session through git, read only. One `rev-parse` and one `git log` per
 * distinct working directory, over the union of that directory's session windows, then the
 * commits are bucketed back to each session in memory. Asking git once per session meant
 * two processes per session, which on a thousand rollouts is the whole runtime.
 */
export async function commitSignalsFor(records: SessionRecord[], commitWindowMinutes: number, lookup = commitsInWindow): Promise<CommitSignals[]> {
  const out: CommitSignals[] = [];
  const byCwd = new Map<string, SessionRecord[]>();
  for (const r of records) {
    if (!r.cwd) {
      out.push({ sessionId: r.sessionId, repo: 'unknown-cwd', commitsInWindow: 0, coAuthorTrailers: 0 });
      continue;
    }
    const list = byCwd.get(r.cwd);
    if (list) list.push(r);
    else byCwd.set(r.cwd, [r]);
  }

  for (const [cwd, sessions] of byCwd) {
    const from = sessions.reduce((a, r) => (r.firstTs < a ? r.firstTs : a), sessions[0]!.firstTs);
    const toMs = sessions.reduce((a, r) => Math.max(a, Date.parse(r.lastTs) + commitWindowMinutes * 60_000), 0);
    const res = await lookup(cwd, from, new Date(toMs).toISOString());
    if (res.status !== 'ok') {
      for (const r of sessions) out.push({ sessionId: r.sessionId, repo: res.status, commitsInWindow: 0, coAuthorTrailers: 0 });
      continue;
    }
    const commits = res.commits.map((c) => ({ ms: Date.parse(c.ts), coAuthored: c.coAuthoredByClaude }));
    for (const r of sessions) {
      const start = Date.parse(r.firstTs);
      const end = Date.parse(r.lastTs) + commitWindowMinutes * 60_000;
      const mine = commits.filter((c) => c.ms >= start && c.ms <= end);
      out.push({ sessionId: r.sessionId, repo: 'ok', commitsInWindow: mine.length, coAuthorTrailers: mine.filter((c) => c.coAuthored).length });
    }
  }
  return out;
}

export function buildSessionsSection(adapter: ProviderAdapter, records: SessionRecord[], signals: CommitSignals[], window: { since: string; until: string }, opts: { commitWindowMinutes: number; idleGapMinutes: number; filesRead: number; error: string | null }): ProviderSection<SessionsSection> {
  const byId = new Map(signals.map((s) => [s.sessionId, s]));
  const summary = records.length && !opts.error ? summarizeEffort(records, signals) : null;
  const blocks: Block[] = [];
  if (opts.error) blocks.push({ kind: 'note', text: `error: ${opts.error}` });
  else if (!adapter.sessions) blocks.push({ kind: 'note', text: 'no session data for this provider yet; no native reader for it yet' });
  else if (!summary) blocks.push({ kind: 'line', text: `no sessions in the window (${opts.filesRead} files checked)` });
  if (summary) {
    blocks.push({
      kind: 'kv',
      rows: [
        ['sessions', `${summary.sessions} (${opts.filesRead} files read)`],
        ['human turns', ms(summary.turns)],
        ['wall', mins(summary.wallMinutes)],
        ['active', `${mins(summary.activeMinutes)} (gaps capped at ${opts.idleGapMinutes} min)`],
        ['tool calls', ms(summary.toolCalls)],
        // Context is re-read on every reply, so it is the term that grows. It goes above
        // effort because it is the larger one.
        ...(summary.contextPeak
          ? [['context peak', `median ${tokens(summary.contextPeak.median)}, p90 ${tokens(summary.contextPeak.p90)} per reply (${summary.contextSessions} of ${summary.sessions} sessions)`] as [string, string]]
          : []),
        ...(summary.contextPerReply ? [['context per reply', `median ${tokens(summary.contextPerReply.median)}`] as [string, string]] : []),
        ...(summary.cacheWriteTtl ? [['cache writes', cacheWriteTtlLine(summary.cacheWriteTtl)] as [string, string]] : []),
        // Counts, not shares: a session can run at more than one level, so shares would not
        // sum to anything, and a share of 6 sessions in 1,087 rounds to a misleading 0%.
        ...(summary.effortMix.length
          ? [['effort mix', `${summary.effortMix.map((e) => `${e.effort} ${e.sessions}`).join(', ')}${summary.effortUnrecorded ? ` (${summary.effortUnrecorded} of ${summary.sessions} unrecorded)` : ''}`] as [string, string]]
          : []),
        ['commit call in transcript', pct(summary.commitCommandShare) + ' of sessions'],
        ['commit in window', `${pct(summary.commitWindowShare)} of ${summary.repoSessions} repo sessions, window [start, end + ${opts.commitWindowMinutes} min], weak proxy`],
        ...(adapter.id === 'anthropic-claude-code' ? [['co-author trailer', `${pct(summary.coAuthorShare)} of repo sessions`] as [string, string]] : []),
        ['cwd missing or not a repo', `${summary.cwdUnknownOrMissing} of ${summary.sessions}`],
      ],
    });
    const recent = [...records].sort((a, b) => b.lastTs.localeCompare(a.lastTs)).slice(0, 8);
    blocks.push({
      kind: 'table',
      columns: ['last activity', 'turns', 'wall', 'active', 'tools', 'commit call', 'commits in window', 'repo'],
      rows: recent.map((r) => {
        const s = byId.get(r.sessionId);
        return [r.lastTs.slice(0, 16).replace('T', ' '), String(r.humanTurns), formatMinutes(r.wallMinutes), formatMinutes(r.activeMinutes), String(r.toolCalls), r.commitCommandsInTranscript ? 'yes' : '', s?.repo === 'ok' ? String(s.commitsInWindow) : '', s?.repo ?? ''];
      }),
    });
    if (summary.coarseDurations) blocks.push({ kind: 'note', text: `${summary.coarseDurations} session(s) have coarse timestamps; their durations are approximate` });
  }
  const data: SessionsSection = {
    source: adapter.sessions ? 'native' : 'none',
    window,
    readerVersion: adapter.sessions?.verifiedAgainst ?? null,
    observedVersions: [...new Set(records.map((r) => r.toolVersion).filter((v): v is string => v !== null))].sort(),
    filesRead: opts.filesRead,
    summary,
    commitWindowMinutes: opts.commitWindowMinutes,
    idleGapMinutes: opts.idleGapMinutes,
    sessions: records.map((r) => {
      const s = byId.get(r.sessionId);
      return {
        sessionId: r.sessionId,
        cwd: r.cwd,
        firstTs: r.firstTs,
        lastTs: r.lastTs,
        wallMinutes: r.wallMinutes,
        activeMinutes: r.activeMinutes,
        humanTurns: r.humanTurns,
        assistantMessages: r.assistantMessages,
        toolCalls: r.toolCalls,
        commitCommandsInTranscript: r.commitCommandsInTranscript,
        commitsInWindow: s?.repo === 'ok' ? s.commitsInWindow : null,
        coAuthorTrailers: s?.repo === 'ok' ? s.coAuthorTrailers : null,
        repo: s?.repo ?? 'unknown-cwd',
        models: r.models,
        efforts: r.efforts,
        contextPeakTokens: r.contextPeakTokens,
        contextFloorTokens: r.contextFloorTokens,
        contextWindowTokens: r.contextWindowTokens,
        cacheWrite1hTokens: r.cacheWrite1hTokens,
        cacheWrite5mTokens: r.cacheWrite5mTokens,
        durationQuality: r.durationQuality,
      };
    }),
    error: opts.error,
  };
  const newer = data.observedVersions.filter((v) => data.readerVersion && v.localeCompare(data.readerVersion, undefined, { numeric: true }) > 0);
  if (newer.length) blocks.push({ kind: 'note', text: `transcripts from ${newer.join(', ')} are newer than the reader was verified against (${data.readerVersion}); fields may have drifted` });
  sessionsSectionSchema.parse(data);
  return { provider: adapter.id, displayName: adapter.displayName, data, blocks };
}

export async function runSessions(ctx: CommandContext, opts: SessionsOptions, deps?: CommandDeps, lookup = commitsInWindow): Promise<number> {
  const d = deps ?? (await defaultDeps(ctx));
  await ensureRoot(ctx.paths);
  await ensurePlans(ctx.paths);
  const plans = await loadPlans(ctx.paths);
  const settings = await loadSettings(ctx.paths);
  const today = todayUtc(d.now());
  const window = resolveWindow(opts, today);
  const adapters = resolveAdapters(plans);
  const wanted = opts.provider?.length ? opts.provider : null;
  if (wanted) for (const id of wanted) if (!adapters.some((a) => a.id === id)) throw new CliError(`unknown provider ${id}; known: ${adapters.map((a) => a.id).join(', ')}`);
  // Naming a provider is asking for it by name, so --provider overrides visibility entirely.
  const { records: baselineRecords } = await listBaseline(ctx.paths.baseline);
  const visible = wanted
    ? new Set(wanted)
    : await visibleProviders(adapters, settings.providers.show, new Set(baselineRecords.map((r) => r.provider)), d.env);
  const hidden = wanted ? [] : adapters.filter((a) => !visible.has(a.id));

  const report: Report<SessionsSection> = { ...emptyReport(window, [CAVEATS.commitProxy, CAVEATS.perProvider]), generatedAt: d.now().toISOString(), providers: {} };
  if (hidden.length) report.caveats.push(hiddenNote(hidden, settings.providers.show));
  let failed = false;
  for (const adapter of adapters) {
    if (!visible.has(adapter.id)) continue;
    let records: SessionRecord[] = [];
    let signals: CommitSignals[] = [];
    let filesRead = 0;
    let error: string | null = null;
    if (adapter.sessions) {
      try {
        const result = await adapter.sessions.read({ since: window.since, until: window.until, idleGapMinutes: settings.idleGapMinutes }, d.env);
        records = result.sessions;
        filesRead = result.filesRead;
        signals = await commitSignalsFor(records, settings.commitWindowMinutes, lookup);
      } catch (e) {
        error = (e as Error).message;
        failed = true;
      }
    }
    report.providers[adapter.id] = buildSessionsSection(adapter, records, signals, { since: window.since, until: window.until }, { commitWindowMinutes: settings.commitWindowMinutes, idleGapMinutes: settings.idleGapMinutes, filesRead, error });
  }
  if (ctx.format === 'html' && ctx.htmlPath) {
    await writeFile(ctx.htmlPath, renderReport(report, 'html'));
    ctx.write(`wrote ${ctx.htmlPath}`);
  } else {
    ctx.write(renderReport(report, ctx.format === 'json' ? 'json' : 'terminal'));
  }
  return failed ? 1 : 0;
}
