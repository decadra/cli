/* eslint-disable @typescript-eslint/no-explicit-any */
// Throwaway probe: reads raw JSONL shapes that are deliberately untyped here.
/**
 * Slice 0 probe. Reads Claude Code and Codex transcripts read-only, runs
 * git log in each session's cwd, and prints the numbers the plan's decision
 * rule needs: ambiguity, sparsity, agreement, and rank correlation.
 * Numbers only. Nothing is written anywhere.
 *
 *   npx tsx scripts/probe-commit-proxy.ts [--days 60]
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

interface S { provider: string; id: string; cwd: string | null; start: number; end: number; turns: number; toolCalls: number; commitCmds: number }

const days = Number(process.argv[process.argv.indexOf('--days') + 1] || 60);
const since = Date.now() - days * 86_400_000;

async function claudeSessions(): Promise<S[]> {
  const root = join(process.env['CLAUDE_CONFIG_DIR']?.split(/[,:]/)[0] ?? join(homedir(), '.claude'), 'projects');
  const out: S[] = [];
  if (!existsSync(root)) return out;
  for (const proj of await readdir(root, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    for (const f of await readdir(join(root, proj.name))) {
      if (!f.endsWith('.jsonl')) continue;
      const s: S = { provider: 'claude', id: f.slice(0, -6), cwd: null, start: 0, end: 0, turns: 0, toolCalls: 0, commitCmds: 0 };
      const cwds = new Map<string, number>();
      for (const line of (await readFile(join(root, proj.name, f), 'utf8')).split('\n')) {
        if (!line) continue;
        let d: any;
        try { d = JSON.parse(line); } catch { continue; }
        const ts = Date.parse(d.timestamp);
        if (Number.isFinite(ts)) { if (!s.start || ts < s.start) s.start = ts; if (ts > s.end) s.end = ts; }
        if (d.cwd) cwds.set(d.cwd, (cwds.get(d.cwd) ?? 0) + 1);
        if (d.isSidechain) continue;
        if (d.type === 'user') {
          const human = d.origin ? d.origin.kind === 'human' : typeof d.message?.content === 'string' && !d.isCompactSummary;
          if (human) s.turns += 1;
        } else if (d.type === 'assistant' && Array.isArray(d.message?.content)) {
          for (const c of d.message.content) {
            if (c.type !== 'tool_use') continue;
            s.toolCalls += 1;
            const cmd = typeof c.input?.command === 'string' ? c.input.command : JSON.stringify(c.input ?? '');
            if (/\bgit\b[^\n|;&]*\bcommit\b/.test(cmd)) s.commitCmds += 1;
          }
        }
      }
      s.cwd = [...cwds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      if (s.end >= since) out.push(s);
    }
  }
  return out;
}

async function codexSessions(): Promise<S[]> {
  const home = process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
  const out: S[] = [];
  async function walk(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      if (!e.name.startsWith('rollout-') || !e.name.endsWith('.jsonl')) continue;
      const s: S = { provider: 'codex', id: e.name, cwd: null, start: 0, end: 0, turns: 0, toolCalls: 0, commitCmds: 0 };
      for (const line of (await readFile(p, 'utf8')).split('\n')) {
        if (!line) continue;
        let d: any;
        try { d = JSON.parse(line); } catch { continue; }
        const ts = Date.parse(d.timestamp);
        if (Number.isFinite(ts)) { if (!s.start || ts < s.start) s.start = ts; if (ts > s.end) s.end = ts; }
        if (d.type === 'session_meta') { s.cwd = d.payload?.cwd ?? null; s.id = d.payload?.id ?? s.id; }
        if (d.type === 'event_msg' && d.payload?.type === 'user_message') s.turns += 1;
        if (d.type === 'response_item' && d.payload?.type === 'function_call') {
          s.toolCalls += 1;
          const a = typeof d.payload.arguments === 'string' ? d.payload.arguments : JSON.stringify(d.payload.arguments ?? '');
          if (/\bgit\b[^\n|;&]*\bcommit\b/.test(a)) s.commitCmds += 1;
        }
      }
      if (s.end >= since) out.push(s);
    }
  }
  await walk(join(home, 'sessions'));
  await walk(join(home, 'archived_sessions'));
  return out;
}

async function commits(cwd: string, from: number, to: number): Promise<number[]> {
  try {
    const { stdout } = await execa('git', ['-C', cwd, 'log', `--since=${new Date(from).toISOString()}`, `--until=${new Date(to).toISOString()}`, '--format=%ct'], { timeout: 20_000 });
    return stdout.split('\n').filter(Boolean).map((t) => Number(t) * 1000);
  } catch { return []; }
}

function rank(v: number[]): number[] { const s = [...v].map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); s.forEach(([, i], k) => { r[i] = k + 1; }); return r; }
function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3) return null;
  const ra = rank(a), rb = rank(b), n = a.length;
  const d2 = ra.reduce((acc, x, i) => acc + (x - rb[i]!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const all = [...(await claudeSessions()), ...(await codexSessions())];
for (const provider of ['claude', 'codex']) {
  const ss = all.filter((s) => s.provider === provider);
  console.log(`\n== ${provider}: ${ss.length} sessions in last ${days} days`);
  if (!ss.length) continue;
  const withRepo = ss.filter((s) => s.cwd && existsSync(join(s.cwd, '.git')));
  console.log(`cwd exists and is a git repo: ${withRepo.length}/${ss.length}`);
  console.log(`transcript has a git commit tool call: ${ss.filter((s) => s.commitCmds > 0).length}/${ss.length}`);
  for (const N of [0, 15, 60]) {
    const attributed = new Map<string, number>();
    let sessionsWithCommit = 0;
    const perSession: number[] = [];
    for (const s of withRepo) {
      const cs = await commits(s.cwd!, s.start, s.end + N * 60_000);
      perSession.push(cs.length);
      if (cs.length) sessionsWithCommit += 1;
      for (const c of cs) { const k = `${s.cwd}:${c}`; attributed.set(k, (attributed.get(k) ?? 0) + 1); }
    }
    const total = attributed.size;
    const ambiguous = [...attributed.values()].filter((n) => n > 1).length;
    const agree = withRepo.filter((s, i) => (perSession[i]! > 0) === (s.commitCmds > 0)).length;
    const rho = spearman(withRepo.map((s) => s.turns), perSession);
    console.log(`N=${N}m: sessions with a commit ${sessionsWithCommit}/${withRepo.length} (sparsity ${withRepo.length ? Math.round(100 * (1 - sessionsWithCommit / withRepo.length)) : 0}%), commits attributed ${total}, ambiguous ${ambiguous} (${total ? Math.round((100 * ambiguous) / total) : 0}%), agreement with transcript signal ${withRepo.length ? Math.round((100 * agree) / withRepo.length) : 0}%, spearman(turns, commits) ${rho === null ? 'n/a' : rho.toFixed(2)}`);
  }
  const wall = ss.map((s) => (s.end - s.start) / 60_000).sort((a, b) => a - b);
  const turns = ss.map((s) => s.turns).sort((a, b) => a - b);
  console.log(`median wall minutes ${wall[Math.floor(wall.length / 2)]?.toFixed(0)}, median human turns ${turns[Math.floor(turns.length / 2)]}, tool calls total ${ss.reduce((a, s) => a + s.toolCalls, 0)}`);
}
