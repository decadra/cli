import { mkdir, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commitSignalsFor } from '../src/commands/sessions';
import type { CommitLookup } from '../src/git/commits';
import type { SessionRecord } from '../src/ingest/types';
import { ensureRoot, resolvePaths } from '../src/config/paths';
import type { CommandContext } from '../src/commands/context';
import type { CommandDeps } from '../src/commands/deps';
import { runSessions } from '../src/commands/sessions';
import { REPORT_TOP_LEVEL_KEYS } from '../src/report/model';
import { CONTENT_PLACEHOLDERS } from './placeholders';
import { builtinAdapters } from '../src/providers/registry';
import { defaultSettings } from '../src/config/settings';

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

async function harness() {
  const paths = resolvePaths(await mkdtemp(join(tmpdir(), 'decadra-')));
  await ensureRoot(paths);
  const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
  const proj = join(home, '.claude', 'projects', '-home-fixture-decadra');
  await mkdir(proj, { recursive: true });
  await cp(fileURLToPath(new URL('./fixtures/claude/sessions/', import.meta.url)), proj, { recursive: true });
  // This test asserts every provider gets a block, so name them all rather than letting
  // 'auto' hide the four with no data in a temp home.
  await writeFile(paths.settings, JSON.stringify({ ...defaultSettings(), providers: { show: builtinAdapters.map((a) => a.id) } }, null, 2) + '\n');
  const out: string[] = [];
  const deps: CommandDeps = { now: () => new Date('2026-09-06T12:00:00Z'), env: { home, platform: 'linux', env: {} }, cwd: '/x', runCcusage: async () => ({}) };
  const ctx: CommandContext = { paths, format: 'terminal', htmlPath: undefined, write: (s) => out.push(s), version: 'test' };
  const fakeLookup = async (cwd: string): Promise<CommitLookup> => (cwd === '/home/fixture/decadra' ? { status: 'ok', commits: [{ hash: 'h', ts: '2026-09-05T20:00:00Z', coAuthoredByClaude: true }] } : { status: 'missing' });
  return { ctx, deps, out, fakeLookup };
}

describe('sessions command', () => {
  it('renders one block per provider, medians for Claude, and the weak-proxy caveat', async () => {
    const h = await harness();
    const code = await runSessions(h.ctx, { months: 1 }, h.deps, h.fakeLookup);
    expect(code).toBe(0);
    const text = strip(h.out.join('\n'));
    expect(text).toMatch(/human turns\s+median \d+/);
    expect(text).toMatch(/commit in window\s+100% of 1 repo sessions/);
    expect(text).toMatch(/co-author trailer\s+100%/);
    expect(text).toContain('Commit correlation is a weak proxy');
    for (const n of ['Claude', 'ChatGPT', 'Cursor', 'Devin', 'Muse Code']) expect(text).toContain(n);
    expect(text).toContain('no session data for this provider yet');
  });

  it('json has the allowed keys, strict section data, and no placeholder leaks', async () => {
    const h = await harness();
    h.ctx.format = 'json';
    await runSessions(h.ctx, { months: 1, provider: ['anthropic-claude-code'] }, h.deps, h.fakeLookup);
    const raw = h.out[0] as string;
    const parsed = JSON.parse(raw) as { providers: Record<string, { data: { summary: { sessions: number } | null; sessions: Array<{ repo: string; cwd: string | null }> } }> };
    expect(Object.keys(parsed).sort()).toEqual([...REPORT_TOP_LEVEL_KEYS].sort());
    const d = parsed.providers['anthropic-claude-code']!.data;
    expect(d.summary?.sessions).toBe(1);
    expect(d.sessions[0]?.repo).toBe('ok');
    for (const p of CONTENT_PLACEHOLDERS) expect(raw).not.toContain(p);
  });
});

describe('commit lookups', () => {
  it('asks git once per working directory and buckets the commits back per session', async () => {
    const at = (h: number): string => `2026-09-05T${String(h).padStart(2, '0')}:00:00.000Z`;
    const rec = (id: string, cwd: string | null, first: number, last: number): SessionRecord => ({
      provider: 'anthropic-claude-code',
      sessionId: id,
      cwd,
      cwds: cwd ? [cwd] : [],
      firstTs: at(first),
      lastTs: at(last),
      wallMinutes: 60,
      activeMinutes: 60,
      humanTurns: 1,
      assistantMessages: 1,
      toolCalls: 0,
      commitCommandsInTranscript: 0,
      models: [],
      efforts: [],
      contextPeakTokens: null,
      contextFloorTokens: null,
      contextWindowTokens: null,
      cacheWrite1hTokens: null,
      cacheWrite5mTokens: null,
      toolVersion: null,
      durationQuality: 'exact',
    });
    const records = [rec('a', '/repo-one', 1, 2), rec('b', '/repo-one', 5, 6), rec('c', '/repo-two', 1, 2), rec('d', null, 1, 2)];

    const asked: string[] = [];
    const lookup = async (cwd: string): Promise<CommitLookup> => {
      asked.push(cwd);
      return {
        status: 'ok',
        commits:
          cwd === '/repo-one'
            ? [
                { hash: 'h1', ts: at(2), coAuthoredByClaude: true },
                { hash: 'h2', ts: at(6), coAuthoredByClaude: false },
                { hash: 'h3', ts: at(12), coAuthoredByClaude: false },
              ]
            : [],
      };
    };

    const signals = await commitSignalsFor(records, 30, lookup);
    // two distinct directories, two lookups, not one per session
    expect(asked).toEqual(['/repo-one', '/repo-two']);
    const by = new Map(signals.map((s) => [s.sessionId, s]));
    expect(by.get('a')).toMatchObject({ commitsInWindow: 1, coAuthorTrailers: 1 });
    expect(by.get('b')).toMatchObject({ commitsInWindow: 1, coAuthorTrailers: 0 });
    expect(by.get('c')).toMatchObject({ repo: 'ok', commitsInWindow: 0 });
    expect(by.get('d')).toMatchObject({ repo: 'unknown-cwd' });
  });
});
