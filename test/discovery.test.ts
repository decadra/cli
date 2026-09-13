import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { builtinAdapters } from '../src/providers/registry';
import { splitDirs } from '../src/ingest/discover';

/** Synthetic directory trees only: file names and layout, no file contents. */
async function fakeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'decadra-fakehome-'));
  const touch = async (rel: string): Promise<void> => {
    await mkdir(join(home, rel, '..'), { recursive: true });
    await writeFile(join(home, rel), '');
  };
  await touch('.claude/projects/-home-u-repo/aaaaaaaa-1111.jsonl');
  await touch('.claude/projects/-home-u-repo/bbbbbbbb-2222.jsonl');
  await touch('.claude/projects/-home-u-repo/aaaaaaaa-1111/subagents/agent-x.jsonl');
  await touch('.codex/sessions/2026/09/05/rollout-2026-09-05T10-00-00-abc.jsonl');
  await touch('.codex/archived_sessions/2026/08/01/rollout-2026-08-01T10-00-00-def.jsonl');
  await touch('.cursor/projects/p1/agent-transcripts/11111111-2222-3333-4444-555555555555/11111111-2222-3333-4444-555555555555.jsonl');
  await touch('.config/Cursor/User/globalStorage/state.vscdb');
  await touch('.local/share/devin/cli/transcripts/s1.json');
  await touch('.local/share/devin/cli/sessions.db');
  await touch('.local/share/muse/sessions/2026/09/05/uuid-1/session.jsonl');
  await touch('.local/share/muse/sessions/2026/09/05/uuid-1/subagents/uuid-2/session.jsonl');
  return home;
}

describe('provider discovery', () => {
  it('finds each provider layout and counts only top-level sessions', async () => {
    const home = await fakeHome();
    const env = { home, platform: 'linux' as const, env: {} };
    const byId = Object.fromEntries(await Promise.all(builtinAdapters.map(async (a) => [a.id, await a.doctor(env)] as const)));
    const summary = (id: string, check: string): string => byId[id]!.find((c) => c.id === check)?.summary ?? '';
    expect(summary('anthropic-claude-code', 'claude.projects')).toMatch(/2 session files/);
    expect(summary('openai-codex', 'codex.sessions')).toMatch(/1 rollouts/);
    expect(summary('openai-codex', 'codex.archived_sessions')).toMatch(/1 rollouts/);
    expect(summary('cursor', 'cursor.transcripts')).toMatch(/1 CLI transcripts/);
    expect(byId['cursor']!.find((c) => c.id === 'cursor.stateDb')?.status).toBe('ok');
    expect(byId['devin']!.find((c) => c.id === 'devin.sessionsDb')?.status).toBe('ok');
    expect(byId['devin']!.find((c) => c.id === 'devin.readOnly')?.status).toBe('warn');
    expect(summary('meta-muse', 'muse.sessions')).toMatch(/1 sessions/);
  });

  it('honours CLAUDE_CONFIG_DIR and CODEX_HOME', async () => {
    const home = await fakeHome();
    const alt = await mkdtemp(join(tmpdir(), 'decadra-alt-'));
    await mkdir(join(alt, 'projects', 'x'), { recursive: true });
    await writeFile(join(alt, 'projects', 'x', 'c.jsonl'), '');
    const claude = builtinAdapters.find((a) => a.id === 'anthropic-claude-code')!;
    const checks = await claude.doctor({ home, platform: 'linux', env: { CLAUDE_CONFIG_DIR: alt } });
    expect(checks[0]?.summary).toMatch(/1 session files/);
    const codex = builtinAdapters.find((a) => a.id === 'openai-codex')!;
    const c2 = await codex.doctor({ home, platform: 'linux', env: { CODEX_HOME: alt } });
    expect(c2.every((c) => c.status === 'absent')).toBe(true);
  });
});

describe('provider directory lists', () => {
  it('treats a Windows drive letter as part of the path, not a list separator', () => {
    // ccusage documents the list as comma separated; ':' cut C:\... into two bad roots.
    expect(splitDirs('C:\\Users\\x\\.claude', 'fb')).toEqual(['C:\\Users\\x\\.claude']);
    expect(splitDirs('C:\\a,D:\\b', 'fb')).toEqual(['C:\\a', 'D:\\b']);
  });

  it('splits and trims a comma separated list, and falls back when it is empty', () => {
    expect(splitDirs('/a, /b ,/c', 'fb')).toEqual(['/a', '/b', '/c']);
    expect(splitDirs(undefined, 'fb')).toEqual(['fb']);
    expect(splitDirs('  ,  ', 'fb')).toEqual(['fb']);
  });
});
