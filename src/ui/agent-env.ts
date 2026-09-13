import { open, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { listDir, splitDirs } from '../ingest/discover';
import type { DoctorEnv } from '../providers/types';

/** Which agent's `!` shell we are in, from environment alone. Pure. */
export type AgentKind = 'anthropic-claude-code' | 'openai-codex' | 'cursor' | null;

export function detectAgent(env: NodeJS.ProcessEnv): AgentKind {
  if (env['CLAUDECODE'] === '1' || (env['AI_AGENT'] ?? '').startsWith('claude-code_')) return 'anthropic-claude-code';
  // Codex 0.144.6 exports none of the sandbox names in its `!` shell. CODEX_THREAD_ID is
  // the one it always sets, and its value is the session id. The rest are kept for builds
  // and sandboxed contexts that do set them.
  if (
    env['CODEX_THREAD_ID'] !== undefined ||
    env['CODEX_MANAGED_BY_NPM'] !== undefined ||
    env['CODEX_SANDBOX'] !== undefined ||
    env['CODEX_SANDBOX_NETWORK_DISABLED'] !== undefined
  )
    return 'openai-codex';
  if (env['CURSOR_TRACE_ID'] !== undefined || env['CURSOR_AGENT'] !== undefined) return 'cursor';
  return null;
}

/** The session id the agent puts in the environment, when it puts one there at all. */
export function sessionIdFromEnv(kind: AgentKind, env: NodeJS.ProcessEnv): string | null {
  const raw =
    kind === 'anthropic-claude-code' ? env['CLAUDE_CODE_SESSION_ID'] : kind === 'openai-codex' ? env['CODEX_THREAD_ID'] : undefined;
  const id = raw?.trim();
  return id ? id : null;
}

/** Claude Code names a project directory by replacing every non-alphanumeric character of the cwd with a dash. */
export function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export interface CurrentSession {
  sessionId: string;
  file: string;
  quality: 'exact' | 'coarse';
}

/** Head of a file, for scanning many lines. Claude transcripts repeat cwd on every line. */
async function readHead(file: string, maxBytes = 64_000): Promise<string[]> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8').split(/\r?\n/);
  } finally {
    await fh.close();
  }
}

/**
 * The first line only, however long it is. A real Codex 0.144.6 `session_meta` line runs
 * 18 to 46 KB, so a fixed head read truncates it and every JSON.parse of it throws. The cap
 * bounds a file that has no newline at all.
 */
async function readFirstLine(file: string, cap = 512_000): Promise<string> {
  const fh = await open(file, 'r');
  try {
    const chunk = Buffer.alloc(64_000);
    const decoder = new StringDecoder('utf8');
    let text = '';
    let pos = 0;
    while (pos < cap) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
      if (bytesRead === 0) break;
      text += decoder.write(chunk.subarray(0, bytesRead));
      const nl = text.indexOf('\n');
      if (nl >= 0) return text.slice(0, nl);
      pos += bytesRead;
    }
    return text + decoder.end();
  } finally {
    await fh.close();
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function newestFile(dir: string, match: (name: string) => boolean): Promise<string | null> {
  let best: { file: string; mtime: number } | null = null;
  for (const name of (await listDir(dir)) ?? []) {
    if (!match(name)) continue;
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (!s.isFile()) continue;
      if (!best || s.mtimeMs > best.mtime) best = { file: full, mtime: s.mtimeMs };
    } catch {
      // vanished between listing and stat
    }
  }
  return best?.file ?? null;
}

/**
 * Codex names the day directory by local date while decadra works in UTC, so today's
 * session can sit in yesterday's or tomorrow's directory depending on the offset. Look at
 * both sides of today rather than walking backwards only.
 */
function nearbyDayDirs(root: string, now: Date): string[] {
  const dirs: string[] = [];
  for (let offset = 1; offset >= -2; offset -= 1) {
    const day = new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    dirs.push(join(root, 'sessions', day.slice(0, 4), day.slice(5, 7), day.slice(8, 10)));
  }
  return dirs;
}

interface SessionMeta {
  id: string | null;
  cwd: string | null;
}

async function readSessionMeta(file: string): Promise<SessionMeta | null> {
  try {
    const meta = JSON.parse(await readFirstLine(file)) as { type?: string; payload?: { id?: string; cwd?: string } };
    if (meta.type !== 'session_meta') return null;
    return { id: meta.payload?.id ?? null, cwd: meta.payload?.cwd ?? null };
  } catch {
    return null;
  }
}

async function findClaudeSession(cwd: string, env: DoctorEnv): Promise<CurrentSession | null> {
  const roots = splitDirs(env.env['CLAUDE_CONFIG_DIR'], join(env.home, '.claude'));
  const wanted = sessionIdFromEnv('anthropic-claude-code', env.env);

  // Claude Code names the session directly, so prefer it over guessing by mtime.
  if (wanted) {
    for (const root of roots) {
      const file = join(root, 'projects', encodeClaudeProjectDir(cwd), `${wanted}.jsonl`);
      if (await isFile(file)) return { sessionId: wanted, file, quality: 'exact' };
    }
  }

  for (const root of roots) {
    const dir = join(root, 'projects', encodeClaudeProjectDir(cwd));
    const file = await newestFile(dir, (n) => n.endsWith('.jsonl'));
    if (!file) continue;
    const confirmed = (await readHead(file)).some((l) => l.includes(`"cwd":${JSON.stringify(cwd)}`));
    return { sessionId: basename(file, '.jsonl'), file, quality: confirmed ? 'exact' : 'coarse' };
  }
  return null;
}

async function findCodexSession(cwd: string, env: DoctorEnv, now: Date): Promise<CurrentSession | null> {
  const wanted = sessionIdFromEnv('openai-codex', env.env);
  let byCwd: CurrentSession | null = null;

  for (const root of splitDirs(env.env['CODEX_HOME'], join(env.home, '.codex'))) {
    for (const dir of nearbyDayDirs(root, now)) {
      const names = ((await listDir(dir)) ?? []).filter((n) => n.startsWith('rollout-') && n.endsWith('.jsonl')).sort().reverse();
      for (const name of names) {
        const file = join(dir, name);
        const meta = await readSessionMeta(file);
        if (!meta) continue;
        // CODEX_THREAD_ID equals session_meta.id, so a match names the exact session.
        if (wanted && meta.id === wanted) return { sessionId: wanted, file, quality: 'exact' };
        if (!byCwd && meta.cwd === cwd) byCwd = { sessionId: meta.id ?? basename(name, '.jsonl'), file, quality: 'exact' };
      }
    }
  }
  return byCwd;
}

async function findCursorSession(env: DoctorEnv): Promise<CurrentSession | null> {
  const projects = join(env.home, '.cursor', 'projects');
  let best: { file: string; mtime: number } | null = null;
  for (const p of (await listDir(projects)) ?? []) {
    const base = join(projects, p, 'agent-transcripts');
    for (const s of (await listDir(base)) ?? []) {
      const file = join(base, s, `${s}.jsonl`);
      try {
        const st = await stat(file);
        if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
      } catch {
        // not a composer-2 layout entry
      }
    }
  }
  return best ? { sessionId: basename(dirname(best.file)), file: best.file, quality: 'coarse' } : null;
}

/**
 * Finds the transcript of the session we are inside. Read-only. Prefers the session id the
 * agent exports over any guess from the filesystem. Returns null when unsure.
 */
export async function findCurrentSession(kind: AgentKind, cwd: string, env: DoctorEnv, now: Date): Promise<CurrentSession | null> {
  if (kind === 'anthropic-claude-code') return findClaudeSession(cwd, env);
  if (kind === 'openai-codex') return findCodexSession(cwd, env, now);
  if (kind === 'cursor') return findCursorSession(env);
  return null;
}
