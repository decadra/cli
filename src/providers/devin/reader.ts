import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openReadOnlyDatabase } from '../../ingest/sqlite';
import { finalize, newRaw, noteCwd, noteTs } from '../../ingest/normalize';
import type { DoctorEnv, ReadOptions, ReadResult, SessionReader } from '../types';
import { mainChain, nodeSchema, sessionSchema, NODE_QUERY, SESSION_QUERY, type DevinResources } from './metadata';

export const devinDbPath = (env: DoctorEnv): string => join(env.home, '.local', 'share', 'devin', 'cli', 'sessions.db');
export interface DevinMetadata extends ReadResult {
  resources: DevinResources[];
  malformedRows: number;
  error: 'unreadable-database' | null;
}
const add = (a: number | null, b: number | null): number | null => a === null || b === null ? null : a + b;

/** Hidden rows are available only to explicit metadata inspection, never ordinary reports. */
export function readDevinMetadata(opts: ReadOptions, env: DoctorEnv, includeHidden = false): DevinMetadata {
  const result: DevinMetadata = { sessions: [], utilization: [], filesRead: 0, resources: [], malformedRows: 0, error: null };
  if (!existsSync(devinDbPath(env))) return result;
  let db: ReturnType<typeof openReadOnlyDatabase> | undefined;
  try {
    db = openReadOnlyDatabase(devinDbPath(env));
    result.filesRead = 1;
    const statements = db.prepare(NODE_QUERY);
    const malformedStatement = db.prepare('SELECT count(*) AS n FROM message_nodes WHERE session_id = ? AND NOT json_valid(chat_message)');
    for (const value of db.prepare(SESSION_QUERY).all()) {
      const parsed = sessionSchema.safeParse(value);
      if (!parsed.success) { result.malformedRows += 1; continue; }
      const s = parsed.data;
      if (s.hidden && !includeHidden) continue;
      const rows = statements.all(s.id);
      const nodes = rows.flatMap((row) => {
        const n = nodeSchema.safeParse(row);
        if (!n.success) { result.malformedRows += 1; return []; }
        return [n.data];
      });
      const malformed = malformedStatement.get(s.id);
      result.malformedRows += Number(malformed?.n ?? 0);
      const chain = mainChain(nodes, s.main_chain_id);
      if (!chain) { result.malformedRows += 1; continue; }
      const raw = newRaw('devin', s.id);
      noteCwd(raw, s.working_directory);
      raw.toolVersion = s.tool_version;
      const resources: DevinResources = { sessionId: s.id, hidden: s.hidden === 1, models: [], inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheCreationTokens: null, latencyMs: null, acu: s.acu, credits: s.credits };
      const humans = new Set<string>();
      for (const n of chain) {
        if (n.role !== 'user' && n.role !== 'assistant') continue;
        const timestamp = n.timestamp ?? new Date(n.created_at * 1000).toISOString();
        if (n.role === 'user') {
          if (n.human !== 1) continue;
          const key = n.message_id ?? timestamp;
          if (humans.has(key)) continue;
          humans.add(key);
          raw.humanTurns += 1;
        } else {
          if (n.model === '<synthetic>') continue;
          const key = n.message_id ?? String(n.node_id);
          if (raw.assistantIds.has(key)) continue;
          raw.assistantIds.add(key);
          if (n.model) raw.models.add(n.model);
          raw.toolCalls += n.tools ?? 0;
          const first = raw.assistantIds.size === 1;
          resources.inputTokens = first ? n.input : add(resources.inputTokens, n.input);
          resources.outputTokens = first ? n.output : add(resources.outputTokens, n.output);
          resources.cacheReadTokens = first ? n.cache_read : add(resources.cacheReadTokens, n.cache_read);
          resources.cacheCreationTokens = first ? n.cache_write : add(resources.cacheCreationTokens, n.cache_write);
          resources.latencyMs = first ? n.latency : add(resources.latencyMs, n.latency);
        }
        noteTs(raw, timestamp);
      }
      const session = finalize(raw, opts.idleGapMinutes);
      if (!session || session.lastTs.slice(0, 10) < opts.since || session.lastTs.slice(0, 10) > opts.until) continue;
      // The configured model is metadata even if a request ended before its first reply.
      resources.models = [...new Set([...session.models, ...(s.model ? [s.model] : [])])].sort();
      result.sessions.push(session);
      result.resources.push(resources);
    }
  } catch {
    result.error = 'unreadable-database';
    result.sessions = [];
    result.resources = [];
  } finally { db?.close(); }
  return result;
}

export const devinReader: SessionReader = {
  verifiedAgainst: '3000.10.21',
  providesUtilization: false,
  async read(opts, env) {
    const { sessions, utilization, filesRead, error } = readDevinMetadata(opts, env);
    if (error) throw new Error('The local session database could not be read with the verified schema.');
    return { sessions, utilization, filesRead };
  },
};
export const VERIFIED_AGAINST = devinReader.verifiedAgainst;
