import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { splitDirs } from '../../ingest/discover';
import { finalize, GIT_COMMIT, jsonLines, newRaw, noteContext, noteContextWindow, noteCwd, noteEffort, noteTs, type RawSession } from '../../ingest/normalize';
import { toolCommandText } from '../../ingest/exec-text';
import type { SessionRecord, UtilizationSample } from '../../ingest/types';
import type { ReadOptions, ReadResult, SessionReader, DoctorEnv } from '../types';

/**
 * Codex rollout reader. Every line has timestamp, type, payload. Human turns
 * are event_msg user_message only. token_count events carry the rate_limits
 * snapshot, the one recorded utilization signal any tool writes. Rollouts
 * are deduped by session_meta id, keeping the one with the latest line, and
 * their human turns by (cwd, timestamp) so a fork or resume is not counted twice.
 */
const PROVIDER = 'openai-codex';

interface Window {
  used_percent?: unknown;
  window_minutes?: unknown;
}

function sample(w: Window | undefined, ts: string, planType: string | null): UtilizationSample | null {
  if (!w || typeof w.used_percent !== 'number') return null;
  return { provider: PROVIDER, ts, windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : null, usedPercent: w.used_percent, planType };
}

function scanLine(raw: RawSession, d: Record<string, unknown>, out: UtilizationSample[], turns: string[]): void {
  noteTs(raw, d['timestamp']);
  const payload = d['payload'] as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') return;
  switch (d['type']) {
    case 'session_meta':
      if (typeof payload['id'] === 'string') raw.sessionId = payload['id'];
      noteCwd(raw, payload['cwd']);
      if (typeof payload['cli_version'] === 'string') raw.toolVersion = payload['cli_version'];
      return;
    case 'turn_context':
      if (typeof payload['model'] === 'string') raw.models.add(payload['model']);
      noteEffort(raw, payload['reasoning_effort']);
      noteCwd(raw, payload['cwd']);
      return;
    case 'event_msg': {
      if (payload['type'] === 'user_message') {
        raw.humanTurns += 1;
        if (typeof d['timestamp'] === 'string') turns.push(d['timestamp']);
      }
      if (payload['type'] === 'thread_settings_applied') {
        // the model is set here on 0.144.x; turn_context carried it on older builds
        const settings = payload['thread_settings'] as { model?: unknown; cwd?: unknown; reasoning_effort?: unknown } | undefined;
        if (typeof settings?.model === 'string') raw.models.add(settings.model);
        noteEffort(raw, settings?.reasoning_effort);
        noteCwd(raw, settings?.cwd);
      }
      if (payload['type'] === 'token_count') {
        // last_token_usage is the level for one reply; total_token_usage is cumulative and
        // would mean something different under the same name.
        const info = payload['info'] as { last_token_usage?: { input_tokens?: unknown }; model_context_window?: unknown } | null | undefined;
        noteContext(raw, info?.last_token_usage?.input_tokens);
        noteContextWindow(raw, info?.model_context_window);
        const rl = payload['rate_limits'] as { primary?: Window; secondary?: Window; plan_type?: unknown } | null | undefined;
        const ts = typeof d['timestamp'] === 'string' ? d['timestamp'] : new Date().toISOString();
        const plan = typeof rl?.plan_type === 'string' ? rl.plan_type : null;
        for (const w of [rl?.primary, rl?.secondary]) {
          const s = sample(w, ts, plan);
          if (s) out.push(s);
        }
      }
      return;
    }
    case 'response_item': {
      if (payload['type'] === 'message' && payload['role'] === 'assistant') raw.assistantIds.add(String(payload['id'] ?? raw.assistantIds.size));
      // 0.144.6 records exec as custom_tool_call; older builds used function_call.
      if (payload['type'] === 'function_call' || payload['type'] === 'custom_tool_call') {
        raw.toolCalls += 1;
        if (GIT_COMMIT.test(toolCommandText(payload))) raw.commitCommands += 1;
      }
      return;
    }
    default:
      return;
  }
}

export async function readCodexRollout(
  file: string,
  idleGapMinutes: number,
): Promise<{ session: SessionRecord | null; utilization: UtilizationSample[]; humanTurnTs: string[] }> {
  const raw = newRaw(PROVIDER, basename(file, '.jsonl'));
  const utilization: UtilizationSample[] = [];
  const humanTurnTs: string[] = [];
  for await (const d of jsonLines(file)) scanLine(raw, d, utilization, humanTurnTs);
  return { session: finalize(raw, idleGapMinutes), utilization, humanTurnTs };
}

async function* rolloutFiles(dir: string, depth = 0): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && depth < 4) yield* rolloutFiles(full, depth + 1);
    else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) yield full;
  }
}

export const codexReader: SessionReader = {
  verifiedAgainst: '0.144.6',
  providesUtilization: true,
  async read(opts: ReadOptions, env: DoctorEnv): Promise<ReadResult> {
    const sinceMs = Date.parse(`${opts.since}T00:00:00Z`);
    const untilMs = Date.parse(`${opts.until}T23:59:59.999Z`);
    const byId = new Map<string, { record: SessionRecord; turns: Set<string> }>();
    const utilization: UtilizationSample[] = [];
    let filesRead = 0;
    for (const root of splitDirs(env.env['CODEX_HOME'], join(env.home, '.codex'))) {
      for (const sub of ['sessions', 'archived_sessions']) {
        for await (const file of rolloutFiles(join(root, sub))) {
          const s = await stat(file);
          if (s.mtimeMs < sinceMs) continue;
          filesRead += 1;
          const { session, utilization: u, humanTurnTs } = await readCodexRollout(file, opts.idleGapMinutes);
          if (!session || Date.parse(session.lastTs) < sinceMs || Date.parse(session.lastTs) > untilMs) continue;
          // A fork or a resume writes a second rollout under the same session_meta id, and
          // an archived copy is a third. Keep the rollout that ran latest, but count each
          // human turn once, keyed by the pair that identifies it across all of them.
          const prev = byId.get(session.sessionId);
          const turns = prev?.turns ?? new Set<string>();
          for (const ts of humanTurnTs) turns.add(`${session.cwd ?? ''}\u0000${ts}`);
          const record = !prev || prev.record.lastTs < session.lastTs ? session : prev.record;
          byId.set(session.sessionId, { record, turns });
          utilization.push(...u.filter((x) => Date.parse(x.ts) >= sinceMs && Date.parse(x.ts) <= untilMs));
        }
      }
    }
    const sessions = [...byId.values()].map(({ record, turns }) => (turns.size ? { ...record, humanTurns: turns.size } : record));
    return { sessions, utilization, filesRead };
  },
};
