import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { claudeReader, readClaudeSession } from '../src/providers/anthropic-claude-code/reader';
import { codexReader, readCodexRollout } from '../src/providers/openai-codex/reader';
import { decodeExecInput, toolCommandText } from '../src/ingest/exec-text';
import { commitsInWindow } from '../src/git/commits';
import { summarizeEffort } from '../src/analysis/effort';
import { finalize, newRaw, noteEffort } from '../src/ingest/normalize';
import type { SessionRecord } from '../src/ingest/types';
import { CONTENT_PLACEHOLDERS } from './placeholders';

const FIXTURE = fileURLToPath(new URL('./fixtures/claude/sessions/2f44129c-0000-4000-8000-000000000001.jsonl', import.meta.url));

describe('claude reader', () => {
  it('reads the redacted real transcript: human turns by origin, distinct assistant ids, tool calls, git commit calls', async () => {
    const rec = await readClaudeSession(FIXTURE, '2f44129c-0000-4000-8000-000000000001', 30);
    expect(rec).not.toBeNull();
    // independent oracle: count human-origin user lines in the fixture text
    const text = await readFile(FIXTURE, 'utf8');
    const humanLines = text.split('\n').filter((l) => l.includes('"type": "user"') && l.includes('"kind": "human"') && !l.includes('"isSidechain": true')).length;
    expect(humanLines).toBeGreaterThan(0);
    expect(rec!.humanTurns).toBe(humanLines);
    expect(rec!.cwd).toBe('/home/fixture/decadra');
    expect(rec!.assistantMessages).toBeGreaterThan(5);
    expect(rec!.toolCalls).toBeGreaterThan(20);
    expect(rec!.commitCommandsInTranscript).toBeGreaterThanOrEqual(1);
    expect(rec!.models).toEqual(['claude-fable-5-1']);
    expect(rec!.toolVersion).toBe('2.1.261');
    expect(rec!.wallMinutes).toBeGreaterThan(0);
    expect(rec!.activeMinutes).toBeLessThanOrEqual(rec!.wallMinutes);
    expect(rec!.durationQuality).toBe('exact');
    for (const v of Object.values(rec!)) expect(typeof v === 'string' ? v : '').not.toContain('[redacted');
  });

  it('ignores subagent folders and files last written before the window', async () => {
    const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    const proj = join(home, '.claude', 'projects', '-home-fixture-decadra');
    await mkdir(proj, { recursive: true });
    await cp(fileURLToPath(new URL('./fixtures/claude/sessions/', import.meta.url)), proj, { recursive: true });
    const env = { home, platform: 'linux' as const, env: {} };
    const inWindow = await claudeReader.read({ since: '2026-09-01', until: '2026-09-30', idleGapMinutes: 30 }, env);
    expect(inWindow.sessions).toHaveLength(1);
    expect(inWindow.filesRead).toBe(1);
    const before = await claudeReader.read({ since: '2026-01-01', until: '2026-01-31', idleGapMinutes: 30 }, env);
    expect(before.sessions).toHaveLength(0);
  });

  it('counts a person taking a turn, not the transcript echoing itself', async () => {
    const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    const proj = join(home, '.claude', 'projects', '-work-proj');
    await mkdir(proj, { recursive: true });
    const cwd = '/work/proj';
    const at = (n: number): string => `2026-09-05T10:${String(n).padStart(2, '0')}:00.000Z`;
    // No origin field on any line: this is the branch that was counting everything.
    const lines = [
      { type: 'user', cwd, timestamp: at(1), message: { content: 'a real question' } },
      { type: 'user', cwd, timestamp: at(2), isMeta: true, message: { content: 'injected system context' } },
      { type: 'user', cwd, timestamp: at(3), message: { content: '<command-name>/clear</command-name>' } },
      { type: 'user', cwd, timestamp: at(4), message: { content: '<local-command-stdout>ok</local-command-stdout>' } },
      { type: 'user', cwd, timestamp: at(5), message: { content: '   ' } },
      { type: 'user', cwd, timestamp: at(6), message: { content: [{ type: 'tool_result', content: 'x' }] } },
      { type: 'user', cwd, timestamp: at(7), message: { content: [{ type: 'text', text: 'a question with a screenshot' }, { type: 'image' }] } },
    ];
    await writeFile(join(proj, 'sess.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rec = await readClaudeSession(join(proj, 'sess.jsonl'), 'sess', 30);
    // the plain question and the one carrying an attachment; nothing else
    expect(rec!.humanTurns).toBe(2);
  });

  it('does not count a record that stands in for a reply that never came', async () => {
    const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    const proj = join(home, '.claude', 'projects', '-work-proj');
    await mkdir(proj, { recursive: true });
    const cwd = '/work/proj';
    const at = (n: number): string => `2026-09-05T10:${String(n).padStart(2, '0')}:00.000Z`;
    const reply = (n: number, id: string, model: string): unknown => ({
      type: 'assistant', cwd, timestamp: at(n),
      message: { id, model, content: [{ type: 'text', text: 'x' }] },
    });
    const lines = [
      { type: 'user', cwd, timestamp: at(1), message: { content: 'a question' } },
      reply(2, 'msg_real_1', 'claude-opus-5'),
      // an api error: a real message id, a model nobody billed for, usage zeroed
      { ...(reply(3, 'msg_err', '<synthetic>') as object), isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429 },
      // and the other shape, which carries no error flag at all
      { ...(reply(4, 'msg_none', '<synthetic>') as object), isApiErrorMessage: false },
      reply(5, 'msg_real_2', 'claude-opus-5'),
    ];
    await writeFile(join(proj, 'sess.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rec = await readClaudeSession(join(proj, 'sess.jsonl'), 'sess', 30);
    expect(rec!.assistantMessages).toBe(2);
    expect(rec!.models).toEqual(['claude-opus-5']);
  });

  it('no placeholder text reaches a session record', async () => {
    const rec = await readClaudeSession(FIXTURE, 'x', 30);
    const json = JSON.stringify(rec);
    // paths are allowed in a record; prompt-text placeholders are not
    for (const p of CONTENT_PLACEHOLDERS) expect(json).not.toContain(p);
  });
});

const CODEX_FIXTURE = fileURLToPath(new URL('./fixtures/codex/sessions/2026/09/05/rollout-2026-09-05T16-07-24-01a07365-0000-7000-8000-000000000001.jsonl', import.meta.url));

describe('codex reader', () => {
  it('reads the redacted real rollout: human turns from user_message only, distinct assistant ids, model from thread settings, rate-limit samples', async () => {
    const { session, utilization } = await readCodexRollout(CODEX_FIXTURE, 30);
    expect(session).not.toBeNull();
    // independent oracles: count line shapes in the fixture text
    const text = await readFile(CODEX_FIXTURE, 'utf8');
    const userMessages = text.split('\n').filter((l) => l.includes('"type":"user_message"')).length;
    const injectedUserLines = text.split('\n').filter((l) => l.includes('"type":"response_item"') && (l.includes('"role":"user"') || l.includes('"role":"developer"'))).length;
    const assistantIds = new Set(text.split('\n').filter((l) => l.includes('"role":"assistant"')).map((l) => /"id":"(msg_[^"]+)"/.exec(l)?.[1]));
    const tokenCounts = text.split('\n').filter((l) => l.includes('"type":"token_count"')).length;
    expect(userMessages).toBe(3);
    expect(injectedUserLines).toBeGreaterThan(userMessages);
    expect(session!.sessionId).toBe('01a07365-0000-7000-8000-000000000001');
    expect(session!.cwd).toBe('/home/fixture');
    expect(session!.humanTurns).toBe(userMessages);
    expect(session!.assistantMessages).toBe(assistantIds.size);
    expect(session!.assistantMessages).toBe(5);
    // the rollout has four custom_tool_call lines; the reader counts function_call only, so toolCalls is not asserted here
    expect(text.split('\n').filter((l) => l.includes('"type":"custom_tool_call"')).length).toBe(4);
    expect(session!.commitCommandsInTranscript).toBe(0);
    expect(session!.models).toEqual(['gpt-5.6-sol']);
    expect(session!.toolVersion).toBe('0.144.6');
    expect(session!.firstTs).toBe('2026-09-05T21:08:24.209Z');
    expect(session!.lastTs).toBe('2026-09-05T21:12:49.277Z');
    expect(session!.wallMinutes).toBe(4);
    expect(session!.activeMinutes).toBeLessThanOrEqual(session!.wallMinutes);
    expect(session!.durationQuality).toBe('exact');
    expect(utilization).toHaveLength(tokenCounts * 2);
    expect(new Set(utilization.map((u) => u.windowMinutes))).toEqual(new Set([300, 10080]));
    expect(utilization.every((u) => u.planType === 'plus' && u.provider === 'openai-codex')).toBe(true);
    expect(Math.max(...utilization.map((u) => u.usedPercent))).toBe(1);
    // paths are allowed in a record; prompt-text placeholders and fake ids are not
    const json = JSON.stringify(session);
    for (const p of CONTENT_PLACEHOLDERS) expect(json).not.toContain(p);
  });

  it('finds the rollout under sessions/YYYY/MM/DD and filters by last activity, not file mtime', async () => {
    const home = await mkdtemp(join(tmpdir(), 'decadra-codex-home-'));
    await cp(fileURLToPath(new URL('./fixtures/codex/sessions/', import.meta.url)), join(home, '.codex', 'sessions'), { recursive: true });
    const env = { home, platform: 'linux' as const, env: {} };
    const inWindow = await codexReader.read({ since: '2026-09-01', until: '2026-09-30', idleGapMinutes: 30 }, env);
    expect(inWindow.sessions).toHaveLength(1);
    expect(inWindow.filesRead).toBe(1);
    expect(inWindow.utilization).toHaveLength(12);
    const before = await codexReader.read({ since: '2026-01-01', until: '2026-01-31', idleGapMinutes: 30 }, env);
    expect(before.sessions).toHaveLength(0);
    expect(before.utilization).toHaveLength(0);
  });

  it('parses the line shapes seen on a real 0.144.6 rollout head plus documented turn shapes', async () => {
    // The first five lines mirror a real rollout head (redacted); the rest are documented turn shapes from older builds.
    const dir = await mkdtemp(join(tmpdir(), 'decadra-codex-'));
    const file = join(dir, 'rollout-2026-09-05T16-07-24-01a07365-0000-7000-8000-000000000001.jsonl');
    const lines = [
      { timestamp: '2026-09-05T21:08:24.209Z', type: 'session_meta', payload: { session_id: '01a07365-0000-7000-8000-000000000001', id: '01a07365-0000-7000-8000-000000000001', timestamp: '2026-09-05T21:07:24.079Z', cwd: '/home/fixture/proj', originator: 'codex-tui', cli_version: '0.144.6', source: 'cli', thread_source: 'user', model_provider: 'openai', base_instructions: { text: '[redacted]' } } },
      { timestamp: '2026-09-05T21:08:24.209Z', type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', started_at: 1788642504, model_context_window: 258400, collaboration_mode_kind: 'default' } },
      { timestamp: '2026-09-05T21:08:24.742Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_shell_command>\n<command>\n[redacted]\n</command>\n</user_shell_command>' }], internal_chat_message_metadata_passthrough: { turn_id: 't1' } } },
      { timestamp: '2026-09-05T21:08:24.746Z', type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1', last_agent_message: null, completed_at: 1788642504, duration_ms: 538 } },
      { timestamp: '2026-09-05T21:11:06.127Z', type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.6-sol', model_provider_id: 'openai', cwd: '/home/fixture/proj', reasoning_effort: 'medium' } } },
      { timestamp: '2026-09-05T16:07:26.000Z', type: 'event_msg', payload: { type: 'user_message', message: '[redacted 1 lines]' } },
      { timestamp: '2026-09-05T16:07:27.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' }] } },
      { timestamp: '2026-09-05T16:07:40.000Z', type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","git commit -m x"]}' } },
      { timestamp: '2026-09-05T16:08:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', id: 'm1' } },
      { timestamp: '2026-09-05T16:08:01.000Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 10 } }, rate_limits: { primary: { used_percent: 12.5, window_minutes: 300 }, secondary: { used_percent: 41, window_minutes: 10080 }, plan_type: 'plus' } } },
      { timestamp: '2026-09-05T16:08:02.000Z', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: null } },
      { timestamp: '2026-09-05T16:08:03.000Z', type: 'unknown_future_type', payload: { anything: true } },
    ];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const { session, utilization } = await readCodexRollout(file, 30);
    expect(session?.sessionId).toBe('01a07365-0000-7000-8000-000000000001');
    expect(session?.cwd).toBe('/home/fixture/proj');
    expect(session?.humanTurns).toBe(1);
    expect(session?.toolCalls).toBe(1);
    expect(session?.commitCommandsInTranscript).toBe(1);
    expect(session?.assistantMessages).toBe(1);
    expect(session?.models).toEqual(['gpt-5.6-sol']);
    expect(session?.toolVersion).toBe('0.144.6');
    expect(utilization.map((u) => [u.windowMinutes, u.usedPercent, u.planType])).toEqual([[300, 12.5, 'plus'], [10080, 41, 'plus']]);
  });
});

describe('normalize and effort', () => {
  it('caps idle gaps in active minutes', () => {
    const raw = newRaw('p', 's');
    raw.timestamps = [0, 60_000, 4 * 3_600_000, 4 * 3_600_000 + 120_000];
    const rec = finalize(raw, 30)!;
    expect(rec.wallMinutes).toBe(242);
    expect(rec.activeMinutes).toBe(33);
  });

  it('summarizes medians, shares, and repo coverage', () => {
    const mk = (id: string, turns: number, commits: number, cwd: string | null) => ({ provider: 'p', sessionId: id, cwd, cwds: cwd ? [cwd] : [], firstTs: 'a', lastTs: 'b', wallMinutes: 10, activeMinutes: 5, humanTurns: turns, assistantMessages: 1, toolCalls: 3, commitCommandsInTranscript: commits, models: [], efforts: [], contextPeakTokens: null, contextFloorTokens: null, contextWindowTokens: null, cacheWrite1hTokens: null, cacheWrite5mTokens: null, toolVersion: null, durationQuality: 'exact' as const });
    const records = [mk('a', 2, 1, '/r'), mk('b', 6, 0, '/r'), mk('c', 4, 0, null)];
    const s = summarizeEffort(records, [
      { sessionId: 'a', repo: 'ok', commitsInWindow: 2, coAuthorTrailers: 1 },
      { sessionId: 'b', repo: 'ok', commitsInWindow: 0, coAuthorTrailers: 0 },
      { sessionId: 'c', repo: 'unknown-cwd', commitsInWindow: 0, coAuthorTrailers: 0 },
    ]);
    expect(s.turns.median).toBe(4);
    expect(s.commitCommandShare).toBeCloseTo(1 / 3, 5);
    expect(s.commitWindowShare).toBe(0.5);
    expect(s.coAuthorShare).toBe(0.5);
    expect(s.repoSessions).toBe(2);
    expect(s.cwdUnknownOrMissing).toBe(1);
  });

  it('divides peak context by assistant replies, not by human turns', () => {
    // Same peak and same turn count, ten times the fan-out. Dividing by turns would call these
    // equal; dividing by replies separates them, which is the thing the number is for.
    const mk = (id: string, replies: number): SessionRecord => ({
      provider: 'p', sessionId: id, cwd: null, cwds: [], firstTs: 'a', lastTs: 'b', wallMinutes: 10, activeMinutes: 5,
      humanTurns: 2, assistantMessages: replies, toolCalls: 3, commitCommandsInTranscript: 0, models: [], efforts: [],
      contextPeakTokens: 400_000, contextFloorTokens: null, contextWindowTokens: null, cacheWrite1hTokens: null, cacheWrite5mTokens: null, toolVersion: null, durationQuality: 'exact',
    });
    const s = summarizeEffort([mk('a', 4), mk('b', 40)], []);
    expect(s.contextPerReply).not.toBeNull();
    expect(s.contextPerReply!.median).toBe(55_000); // mean of 100_000 and 10_000
    expect(s.contextPerReply!.p90).toBe(100_000);
    expect(s.contextSessions).toBe(2);
  });

  it('leaves context per reply null when no session recorded a peak', () => {
    const mk = (id: string): SessionRecord => ({
      provider: 'p', sessionId: id, cwd: null, cwds: [], firstTs: 'a', lastTs: 'b', wallMinutes: 1, activeMinutes: 1,
      humanTurns: 1, assistantMessages: 1, toolCalls: 0, commitCommandsInTranscript: 0, models: [], efforts: [],
      contextPeakTokens: null, contextFloorTokens: null, contextWindowTokens: null, cacheWrite1hTokens: null, cacheWrite5mTokens: null, toolVersion: null, durationQuality: 'exact',
    });
    const s = summarizeEffort([mk('a')], []);
    expect(s.contextPerReply).toBeNull();
    expect(s.contextPeak).toBeNull();
  });
});

describe('git commits', () => {
  it('reads commits in a window with co-author trailers, and reports missing and non-repo dirs', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'decadra-repo-'));
    const git = (...args: string[]) => execa('git', ['-C', repo, ...args], { env: { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' } });
    await git('init', '-q');
    await writeFile(join(repo, 'a'), '1');
    await git('add', 'a');
    await git('commit', '-q', '-m', 'first\n\nCo-Authored-By: Claude <noreply@anthropic.com>');
    await writeFile(join(repo, 'a'), '2');
    await git('commit', '-q', '-am', 'second');
    const now = new Date();
    const res = await commitsInWindow(repo, new Date(now.getTime() - 3_600_000).toISOString(), new Date(now.getTime() + 3_600_000).toISOString());
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.commits).toHaveLength(2);
      expect(res.commits.filter((c) => c.coAuthoredByClaude)).toHaveLength(1);
    }
    expect((await commitsInWindow(join(repo, 'nope'), 'a', 'b')).status).toBe('missing');
    const plain = await mkdtemp(join(tmpdir(), 'decadra-plain-'));
    expect((await commitsInWindow(plain, 'a', 'b')).status).toBe('not-a-repo');
  });
});

describe('codex tool calls and the commit rule', () => {
  it('decodes the exec input so the newline guard applies', () => {
    // The raw text carries backslash-n, so a regex forbidding a newline never fired and
    // "git status" on one line matched "commit" on the next.
    const input = 'const r = await tools.exec_command({cmd:"git -C \'/x\' status --short\\ngit commit -m \'y\'","workdir":"/x"});';
    expect(input).toContain('\\n');
    const decoded = decodeExecInput(input);
    expect(decoded).toContain('\n');
    expect(decoded).toBe("git -C '/x' status --short\ngit commit -m 'y'");
  });

  it('reads the command out of either tool call shape', () => {
    expect(toolCommandText({ type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"git commit -m x"});' })).toBe('git commit -m x');
    expect(toolCommandText({ type: 'function_call', arguments: JSON.stringify({ command: ['git', 'commit', '-m', 'x'] }) })).toBe('git commit -m x');
    expect(toolCommandText({ type: 'function_call', arguments: JSON.stringify({ command: 'git commit -m x' }) })).toBe('git commit -m x');
    expect(toolCommandText({ type: 'custom_tool_call', name: 'exec', input: 'no cmd here' })).toBe('no cmd here');
  });

  it('counts custom_tool_call as a tool call and finds the commit in it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-codex-'));
    const file = join(dir, 'rollout-x.jsonl');
    const lines = [
      { timestamp: '2026-09-05T10:00:00.000Z', type: 'session_meta', payload: { id: 'sess-1', cwd: '/work/proj', cli_version: '0.144.6' } },
      { timestamp: '2026-09-05T10:01:00.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"ls -la"});' } },
      { timestamp: '2026-09-05T10:02:00.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', input: 'const r = await tools.exec_command({cmd:"git commit -m \'done\'"});' } },
    ];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const { session } = await readCodexRollout(file, 30);
    expect(session!.toolCalls).toBe(2);
    expect(session!.commitCommandsInTranscript).toBe(1);
  });

  it('counts a human turn once across a fork, a resume, and an archived copy', async () => {
    const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    const day = join(home, '.codex', 'sessions', '2026', '09', '05');
    const archived = join(home, '.codex', 'archived_sessions');
    await mkdir(day, { recursive: true });
    await mkdir(archived, { recursive: true });
    const meta = { timestamp: '2026-09-05T10:00:00.000Z', type: 'session_meta', payload: { id: 'sess-1', cwd: '/work/proj', cli_version: '0.144.6' } };
    const turn = (ts: string): unknown => ({ timestamp: ts, type: 'event_msg', payload: { type: 'user_message' } });
    const write = async (file: string, ts: string[]): Promise<void> => {
      await writeFile(file, [meta, ...ts.map(turn)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    };
    // Same two opening turns in all three, then one new turn in the resume.
    const shared = ['2026-09-05T10:01:00.000Z', '2026-09-05T10:02:00.000Z'];
    await write(join(day, 'rollout-a.jsonl'), shared);
    await write(join(day, 'rollout-b.jsonl'), [...shared, '2026-09-05T10:30:00.000Z']);
    await write(join(archived, 'rollout-c.jsonl'), shared);

    const env = { home, platform: 'linux' as const, env: {} };
    const out = await codexReader.read({ since: '2026-09-01', until: '2026-09-30', idleGapMinutes: 30 }, env);
    expect(out.filesRead).toBe(3);
    expect(out.sessions).toHaveLength(1);
    // seven user_message lines on disk, three distinct (cwd, timestamp) pairs
    expect(out.sessions[0]!.humanTurns).toBe(3);
    expect(out.sessions[0]!.sessionId).toBe('sess-1');
  });
});

describe('effort levels', () => {
  it('reads the effort Claude writes beside cwd, not inside message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-eff-'));
    const file = join(dir, 'sess.jsonl');
    const at = (n: number): string => `2026-09-05T10:0${n}:00.000Z`;
    const line = (n: number, effort: string | undefined): unknown => ({
      type: 'assistant', cwd: '/work/proj', timestamp: at(n), ...(effort === undefined ? {} : { effort }),
      message: { id: `msg_${n}`, model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }] },
    });
    await writeFile(file, [line(1, 'xhigh'), line(2, 'xhigh'), line(3, 'max'), line(4, undefined)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rec = await readClaudeSession(file, 'sess', 30);
    expect(rec!.efforts).toEqual(['max', 'xhigh']);
  });

  it('does not take a sidechain effort as the session effort', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-eff-'));
    const file = join(dir, 'sess.jsonl');
    const at = (n: number): string => `2026-09-05T10:0${n}:00.000Z`;
    const line = (n: number, effort: string, sidechain: boolean): unknown => ({
      type: 'assistant', cwd: '/work/proj', timestamp: at(n), effort, ...(sidechain ? { isSidechain: true } : {}),
      message: { id: `msg_${n}`, model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }] },
    });
    // Effort is read before the assistant narrowing, so the sidechain guard has to be its own.
    await writeFile(file, [line(1, 'low', false), line(2, 'max', true), line(3, 'max', true)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rec = await readClaudeSession(file, 'sess', 30);
    expect(rec!.efforts).toEqual(['low']);
    expect(rec!.assistantMessages).toBe(1);
  });

  it('reads reasoning_effort from both places Codex writes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-eff-'));
    const file = join(dir, 'rollout-x.jsonl');
    const lines = [
      { timestamp: '2026-09-05T10:00:00.000Z', type: 'session_meta', payload: { id: 's', cwd: '/work/proj', cli_version: '0.144.6' } },
      { timestamp: '2026-09-05T10:01:00.000Z', type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-5.6', reasoning_effort: 'low' } } },
      { timestamp: '2026-09-05T10:02:00.000Z', type: 'turn_context', payload: { model: 'gpt-5.6', reasoning_effort: 'xhigh' } },
    ];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const { session } = await readCodexRollout(file, 30);
    expect(session!.efforts).toEqual(['low', 'xhigh']);
  });

  it('takes any short label a vendor invents, but not free text', async () => {
    const raw = newRaw('p', 's');
    // observed across two tools: low, medium, high, xhigh, max, ultra, and banana
    for (const ok of ['low', 'xhigh', 'max', 'ultra', 'banana', 'p1_5']) noteEffort(raw, ok);
    for (const no of ['', ' ', '-leading', 'a'.repeat(40), 'has space', 42, null, undefined]) noteEffort(raw, no);
    expect([...raw.efforts].sort()).toEqual(['banana', 'low', 'max', 'p1_5', 'ultra', 'xhigh']);
  });

  it('counts sessions per label and never maps one vendor scale onto another', () => {
    const mk = (id: string, efforts: string[]): SessionRecord =>
      ({ provider: 'p', sessionId: id, cwd: null, cwds: [], firstTs: 'a', lastTs: 'b', wallMinutes: 1, activeMinutes: 1, humanTurns: 1, assistantMessages: 1, toolCalls: 0, commitCommandsInTranscript: 0, models: [], efforts, contextPeakTokens: null, contextFloorTokens: null, contextWindowTokens: null, cacheWrite1hTokens: null, cacheWrite5mTokens: null, toolVersion: null, durationQuality: 'exact' });
    const s = summarizeEffort([mk('a', ['high']), mk('b', ['high', 'max']), mk('c', [])], []);
    expect(s.effortMix).toEqual([{ effort: 'high', sessions: 2 }, { effort: 'max', sessions: 1 }]);
    expect(s.effortUnrecorded).toBe(1);
  });
});

describe('context growth', () => {
  it('measures what the model read for each reply, and takes the peak', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-ctx-'));
    const file = join(dir, 'sess.jsonl');
    const at = (n: number): string => `2026-09-05T10:${String(n).padStart(2, '0')}:00.000Z`;
    const reply = (n: number, cacheRead: number, write: number, input: number): unknown => ({
      type: 'assistant', cwd: '/work/proj', timestamp: at(n),
      message: { id: `msg_${n}`, model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: { cache_read_input_tokens: cacheRead, cache_creation_input_tokens: write, input_tokens: input } },
    });
    const lines = [
      reply(1, 30_000, 500, 200),
      reply(2, 120_000, 400, 100),
      reply(3, 300_000, 0, 50),
      // a reply that never came reports zeros; it must not become the floor
      { type: 'assistant', cwd: '/work/proj', timestamp: at(4), isApiErrorMessage: true, message: { id: 'msg_e', model: '<synthetic>', usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, input_tokens: 0 } } },
    ];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rec = await readClaudeSession(file, 'sess', 30);
    expect(rec!.contextFloorTokens).toBe(30_700);
    expect(rec!.contextPeakTokens).toBe(300_050);
    // Claude states no window
    expect(rec!.contextWindowTokens).toBeNull();
  });

  it('splits cache writes by the TTL the record asked for', async () => {
    // From the redacted real transcript. One cache-creation rate is charged to every write
    // whatever its TTL, so which TTL the work used is what says whether that rate fits.
    const rec = await readClaudeSession(FIXTURE, '2f44129c-0000-4000-8000-000000000001', 30);
    expect(rec!.cacheWrite1hTokens).toBe(575_756);
    expect(rec!.cacheWrite5mTokens).toBe(0);
  });

  it('leaves the split null when no record states one, rather than calling it zero', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-ttl-'));
    const file = join(dir, 'sess.jsonl');
    const line = {
      type: 'assistant', cwd: '/work/proj', timestamp: '2026-09-05T10:00:00.000Z',
      message: { id: 'msg_1', model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: { cache_creation_input_tokens: 900, input_tokens: 10 } },
    };
    await writeFile(file, JSON.stringify(line) + '\n');
    const rec = await readClaudeSession(file, 'sess', 30);
    expect(rec!.cacheWrite1hTokens).toBeNull();
    expect(rec!.cacheWrite5mTokens).toBeNull();
  });

  it('does not take a sidechain cache write as the session\'s', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-ttl-'));
    const file = join(dir, 'sess.jsonl');
    const line = (n: number, oneHour: number, fiveMin: number, sidechain: boolean): unknown => ({
      type: 'assistant', cwd: '/work/proj', timestamp: `2026-09-05T10:0${n}:00.000Z`, ...(sidechain ? { isSidechain: true } : {}),
      message: { id: `msg_${n}`, model: 'claude-opus-5', content: [{ type: 'text', text: 'x' }], usage: { cache_creation: { ephemeral_1h_input_tokens: oneHour, ephemeral_5m_input_tokens: fiveMin } } },
    });
    await writeFile(file, [line(1, 1000, 0, false), line(2, 0, 5000, true)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rec = await readClaudeSession(file, 'sess', 30);
    expect(rec!.cacheWrite1hTokens).toBe(1000);
    expect(rec!.cacheWrite5mTokens).toBe(0);
  });

  it('reads the level and the window Codex states', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-ctx-'));
    const file = join(dir, 'rollout-x.jsonl');
    const tc = (n: number, input: number): unknown => ({
      timestamp: `2026-09-05T10:0${n}:00.000Z`, type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: input }, total_token_usage: { total_tokens: 9_000_000 }, model_context_window: 258_400 } },
    });
    const lines = [{ timestamp: '2026-09-05T10:00:00.000Z', type: 'session_meta', payload: { id: 's', cwd: '/work/proj' } }, tc(1, 12_000), tc(2, 41_000)];
    await writeFile(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const { session } = await readCodexRollout(file, 30);
    // the cumulative total must not be mistaken for the level
    expect(session!.contextPeakTokens).toBe(41_000);
    expect(session!.contextFloorTokens).toBe(12_000);
    expect(session!.contextWindowTokens).toBe(258_400);
  });
});
