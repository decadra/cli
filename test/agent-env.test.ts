import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectAgent, encodeClaudeProjectDir, findCurrentSession, sessionIdFromEnv } from '../src/ui/agent-env';

const CLOCK = new Date('2026-09-06T12:00:00Z');

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'decadra-home-'));
}

/** A session_meta line the size Codex 0.144.6 really writes: well past any fixed head read. */
function bigSessionMeta(id: string, cwd: string): string {
  const instructions = 'x'.repeat(40_000);
  return JSON.stringify({ timestamp: '2026-09-06T11:00:00Z', type: 'session_meta', payload: { id, cwd, instructions } }) + '\n';
}

function codexDay(root: string, day: string): string {
  return join(root, 'sessions', day.slice(0, 4), day.slice(5, 7), day.slice(8, 10));
}

describe('agent detection', () => {
  it('recognises each agent from its environment and nothing on a plain shell', () => {
    expect(detectAgent({ CLAUDECODE: '1' })).toBe('anthropic-claude-code');
    expect(detectAgent({ AI_AGENT: 'claude-code_2-1-261_agent' })).toBe('anthropic-claude-code');
    expect(detectAgent({ CURSOR_TRACE_ID: 'abc' })).toBe('cursor');
    expect(detectAgent({ PATH: '/usr/bin', HOME: '/home/x' })).toBeNull();
  });

  it('recognises the codex shell by the names it actually exports', () => {
    // 0.144.6 exports none of the sandbox names from `!`; these three are what is there.
    expect(detectAgent({ CODEX_THREAD_ID: '01a07365-0000-7000-8000-000000000001' })).toBe('openai-codex');
    expect(detectAgent({ CODEX_MANAGED_BY_NPM: '1' })).toBe('openai-codex');
    expect(detectAgent({ CODEX_SANDBOX_NETWORK_DISABLED: '1' })).toBe('openai-codex');
  });

  it('reads the session id out of the environment when the agent puts one there', () => {
    expect(sessionIdFromEnv('anthropic-claude-code', { CLAUDE_CODE_SESSION_ID: 'sess-a' })).toBe('sess-a');
    expect(sessionIdFromEnv('openai-codex', { CODEX_THREAD_ID: 'thread-a' })).toBe('thread-a');
    expect(sessionIdFromEnv('anthropic-claude-code', { CLAUDE_CODE_SESSION_ID: '  ' })).toBeNull();
    expect(sessionIdFromEnv('cursor', { CURSOR_TRACE_ID: 'x' })).toBeNull();
    expect(sessionIdFromEnv(null, {})).toBeNull();
  });

  it('encodes a cwd the way Claude Code names project directories', () => {
    expect(encodeClaudeProjectDir('/home/user/decadra')).toBe('-home-user-decadra');
    expect(encodeClaudeProjectDir('/Users/rish/my.repo_v2')).toBe('-Users-rish-my-repo-v2');
  });
});

describe('current claude session', () => {
  it('finds it by cwd and confirms it from the transcript', async () => {
    const h = await home();
    const cwd = '/work/proj';
    const dir = join(h, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    const line = (ts: string): string => JSON.stringify({ type: 'user', cwd, timestamp: ts }) + '\n';
    await writeFile(join(dir, 'old.jsonl'), line('2026-09-01T00:00:00Z'));
    await writeFile(join(dir, 'new.jsonl'), line('2026-09-05T00:00:00Z'));
    // Set mtimes rather than sleeping: a tie makes newestFile depend on readdir order.
    await utimes(join(dir, 'old.jsonl'), new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'));
    await utimes(join(dir, 'new.jsonl'), new Date('2026-09-05T00:00:00Z'), new Date('2026-09-05T00:00:00Z'));

    const found = await findCurrentSession('anthropic-claude-code', cwd, { home: h, platform: 'linux', env: {} }, CLOCK);
    expect(found?.sessionId).toBe('new');
    expect(found?.quality).toBe('exact');
    expect(await findCurrentSession('anthropic-claude-code', '/elsewhere', { home: h, platform: 'linux', env: {} }, CLOCK)).toBeNull();
  });

  it('prefers CLAUDE_CODE_SESSION_ID over the newest file', async () => {
    const h = await home();
    const cwd = '/work/proj';
    const dir = join(h, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    const line = JSON.stringify({ type: 'user', cwd, timestamp: '2026-09-05T00:00:00Z' }) + '\n';
    await writeFile(join(dir, 'wanted.jsonl'), line);
    await writeFile(join(dir, 'newer.jsonl'), line);
    await utimes(join(dir, 'wanted.jsonl'), new Date('2026-09-01T00:00:00Z'), new Date('2026-09-01T00:00:00Z'));
    await utimes(join(dir, 'newer.jsonl'), new Date('2026-09-06T00:00:00Z'), new Date('2026-09-06T00:00:00Z'));

    const env = { home: h, platform: 'linux' as const, env: { CLAUDE_CODE_SESSION_ID: 'wanted' } };
    const found = await findCurrentSession('anthropic-claude-code', cwd, env, CLOCK);
    expect(found?.sessionId).toBe('wanted');
    expect(found?.quality).toBe('exact');
  });

  it('falls back to the newest file when the named session is not in this project', async () => {
    const h = await home();
    const cwd = '/work/proj';
    const dir = join(h, '.claude', 'projects', encodeClaudeProjectDir(cwd));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'only.jsonl'), JSON.stringify({ type: 'user', cwd, timestamp: '2026-09-05T00:00:00Z' }) + '\n');
    const env = { home: h, platform: 'linux' as const, env: { CLAUDE_CODE_SESSION_ID: 'somewhere-else' } };
    expect((await findCurrentSession('anthropic-claude-code', cwd, env, CLOCK))?.sessionId).toBe('only');
  });
});

describe('current codex session', () => {
  it('parses a session_meta line far larger than any fixed head read', async () => {
    const h = await home();
    const dir = codexDay(join(h, '.codex'), '2026-09-06');
    await mkdir(dir, { recursive: true });
    const meta = bigSessionMeta('sess-1', '/work/proj');
    expect(meta.length).toBeGreaterThan(16_000);
    await writeFile(join(dir, 'rollout-a.jsonl'), meta);

    const found = await findCurrentSession('openai-codex', '/work/proj', { home: h, platform: 'linux', env: {} }, CLOCK);
    expect(found?.sessionId).toBe('sess-1');
    expect(found?.quality).toBe('exact');
  });

  it('finds today in a directory named by a local date ahead of UTC', async () => {
    const h = await home();
    // UTC+13: 2026-09-07 10:00 local is 2026-09-06 21:00 UTC, so codex names the day 09-07.
    const dir = codexDay(join(h, '.codex'), '2026-09-07');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rollout-a.jsonl'), bigSessionMeta('sess-ahead', '/work/proj'));

    const clock = new Date('2026-09-06T21:00:00Z');
    const found = await findCurrentSession('openai-codex', '/work/proj', { home: h, platform: 'linux', env: {} }, clock);
    expect(found?.sessionId).toBe('sess-ahead');
  });

  it('prefers CODEX_THREAD_ID over a cwd match and searches every root', async () => {
    const h = await home();
    const rootA = join(h, 'a');
    const rootB = join(h, 'b');
    const dirA = codexDay(rootA, '2026-09-06');
    const dirB = codexDay(rootB, '2026-09-06');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    await writeFile(join(dirA, 'rollout-a.jsonl'), bigSessionMeta('other', '/work/proj'));
    await writeFile(join(dirB, 'rollout-b.jsonl'), bigSessionMeta('thread-1', '/somewhere/else'));

    const env = { home: h, platform: 'linux' as const, env: { CODEX_HOME: `${rootA},${rootB}`, CODEX_THREAD_ID: 'thread-1' } };
    const found = await findCurrentSession('openai-codex', '/work/proj', env, CLOCK);
    expect(found?.sessionId).toBe('thread-1');
    expect(found?.file).toBe(join(dirB, 'rollout-b.jsonl'));
  });

  it('falls back to the cwd match when the named thread is not on disk', async () => {
    const h = await home();
    const dir = codexDay(join(h, '.codex'), '2026-09-06');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rollout-a.jsonl'), bigSessionMeta('sess-1', '/work/proj'));

    const env = { home: h, platform: 'linux' as const, env: { CODEX_THREAD_ID: 'never-written' } };
    expect((await findCurrentSession('openai-codex', '/work/proj', env, CLOCK))?.sessionId).toBe('sess-1');
  });

  it('returns null when no rollout matches', async () => {
    const h = await home();
    const dir = codexDay(join(h, '.codex'), '2026-09-06');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rollout-a.jsonl'), bigSessionMeta('sess-1', '/other/proj'));
    expect(await findCurrentSession('openai-codex', '/work/proj', { home: h, platform: 'linux', env: {} }, CLOCK)).toBeNull();
  });
});

describe('this container', () => {
  it('matches when it is a Claude Code session', async () => {
    if (!process.env['CLAUDECODE']) return;
    const env = { home: homedir(), platform: process.platform, env: process.env };
    const found = await findCurrentSession('anthropic-claude-code', process.cwd(), env, new Date());
    expect(found).not.toBeNull();
    expect(existsSync(found!.file)).toBe(true);
  });
});
