import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectChecks } from '../src/commands/doctor';
import { runNow } from '../src/commands/now';
import { runAssess } from '../src/commands/assess';
import { runSessions } from '../src/commands/sessions';
import { defaultPlans } from '../src/config/plans';
import { addBaseline } from '../src/store/baseline';
import { REPORT_TOP_LEVEL_KEYS } from '../src/report/model';
import { dailySeries, harness, strip } from './harness';

/** Scenario ids match docs/testing/scenarios.md. */
describe('S1 first run on a clean machine', () => {
  it('creates config once, lists every provider, and is idempotent', async () => {
    const h = await harness({ claudeEmpty: true, codexEmpty: true });
    expect(existsSync(h.ctx.paths.plans)).toBe(false);
    const first = await collectChecks(h.ctx, h.deps);
    expect(existsSync(h.ctx.paths.plans)).toBe(true);
    expect(first.find((c) => c.id === 'plans')?.detail).toMatch(/created just now/);
    for (const id of ['anthropic-claude-code', 'openai-codex', 'cursor', 'devin', 'meta-muse']) expect(first.some((c) => c.provider === id)).toBe(true);
    expect(first.some((c) => c.status === 'fail')).toBe(false);
    const before = await readFile(h.ctx.paths.plans, 'utf8');
    const second = await collectChecks(h.ctx, h.deps);
    expect(second.find((c) => c.id === 'plans')?.detail).toBeUndefined();
    expect(await readFile(h.ctx.paths.plans, 'utf8')).toBe(before);
  });
});

describe('S2 in-session readout from Claude Code', () => {
  it('prints one block for the current session, no bill line, exit 0, within budget', async () => {
    const h = await harness();
    h.deps.env.env = { CLAUDECODE: '1' };
    const dir = join(h.deps.env.home, '.claude', 'projects', '-work-proj');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2f44129c-0000-4000-8000-000000000001.jsonl'), JSON.stringify({ type: 'user', cwd: '/work/proj' }) + '\n');
    const started = Date.now();
    expect(await runNow(h.ctx, {}, h.deps)).toBe(0);
    expect(Date.now() - started).toBeLessThan(1500);
    const text = strip(h.out.join('\n'));
    expect(text).toContain('Claude  (anthropic-claude-code)');
    expect(text).not.toContain('ChatGPT');
    expect(text).not.toMatch(/You pay/);
    expect(text).toMatch(/this session\s+\$/);
    expect(text).toContain('Readout only');
  });
});

describe('S3 month-end review with anchors', () => {
  it('produces a verdict with evidence, a ceiling column, and appends verdicts', async () => {
    const h = await harness({ daily: dailySeries(['2026-07', '2026-08'], 0.5) });
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-06-01', provider: 'anthropic-claude-code', product: 'Claude Max 20x', tier: 'max20', price: 200, currency: 'USD', billing: 'monthly' });
    const plans = defaultPlans();
    plans.providers['anthropic-claude-code']!.anchorApiEquivalentUsd = { short: 5, weekly: 25 };
    await writeFile(h.ctx.paths.plans, JSON.stringify(plans));
    expect(await runAssess(h.ctx, { months: 3, provider: ['anthropic-claude-code'] }, h.deps)).toBe(0);
    const text = strip(h.out.join('\n'));
    // Cells, not separators: the row must carry price, effective cost, multiple and ceiling in
    // that order. Asserting on border characters pinned the test to one table library.
    // Cells in order: price, effective cost, multiple, the bar drawn from it, then the ceiling.
    expect(text).toMatch(/Pro\s+\$20\.00\s+\$20\.00\s+[\d.]+x\s+\S*\s*fits \(est\.\)/);
    expect(text).toMatch(/Claude: on observed usage, Pro fits; held plan is Max 20x \(downgrade/);
    expect(text).toContain('Median list-price equivalent');
    const verdicts = (await readFile(h.ctx.paths.verdicts, 'utf8')).trim().split('\n');
    expect(verdicts).toHaveLength(1);
    expect(JSON.parse(verdicts[0] as string)).toMatchObject({ provider: 'anthropic-claude-code', direction: 'downgrade', bestFitPlan: 'pro', plansAsOf: '2026-09-05' });
  });
});

describe('S4 tier change mid-window', () => {
  it('uses the plan held on the last day and lists both plans held', async () => {
    const h = await harness({ daily: dailySeries(['2026-07', '2026-08'], 0.5) });
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-06-01', provider: 'anthropic-claude-code', product: 'Claude Max 20x', tier: 'max20', price: 200, currency: 'USD', billing: 'monthly' });
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-08-15', provider: 'anthropic-claude-code', product: 'Claude Max 5x', tier: 'max5', price: 100, currency: 'USD', billing: 'monthly' });
    h.ctx.format = 'json';
    await runAssess(h.ctx, { months: 3, provider: ['anthropic-claude-code'] }, h.deps);
    const parsed = JSON.parse(h.out[0] as string) as { providers: Record<string, { data: { heldPlanChanges: string[]; verdict: { heldPlan: string; evidence: string[] } } }> };
    const d = parsed.providers['anthropic-claude-code']!.data;
    expect(d.verdict.heldPlan).toBe('max5');
    expect(d.heldPlanChanges).toEqual(['max20', 'max5']);
    expect(d.verdict.evidence.join(' ')).toMatch(/Plans held across the window: Max 20x, then Max 5x/);
  });
});

describe('S6 Codex-only user', () => {
  it('reads Codex rows and reports Claude as having no evidence rather than failing', async () => {
    const h = await harness({ claudeEmpty: true });
    h.ctx.format = 'json';
    expect(await runAssess(h.ctx, { months: 1 }, h.deps)).toBe(0);
    const parsed = JSON.parse(h.out[0] as string) as { providers: Record<string, { data: { source: string; months: Array<{ amount: number }>; verdict: { direction: string } } }> };
    expect(parsed.providers['openai-codex']!.data.months[0]?.amount).toBeCloseTo(0.2578, 4);
    expect(parsed.providers['anthropic-claude-code']!.data.verdict.direction).toBe('unknown');
    h.out.length = 0;
    h.ctx.format = 'terminal';
    const dir = join(h.deps.env.home, '.codex', 'sessions', '2026', '09', '05');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rollout-2026-09-05T16-07-24-01a07365-0000-7000-8000-000000000001.jsonl'), [
      { timestamp: '2026-09-05T16:07:24.000Z', type: 'session_meta', payload: { id: '01a07365', cwd: '/nowhere', cli_version: '0.114.0' } },
      { timestamp: '2026-09-05T16:07:26.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'x' } },
      { timestamp: '2026-09-05T16:07:27.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [] } },
      { timestamp: '2026-09-05T16:09:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', id: 'a1' } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    expect(await runSessions(h.ctx, { months: 1, provider: ['openai-codex'] }, h.deps, async () => ({ status: 'missing' }))).toBe(0);
    const text = strip(h.out.join('\n'));
    expect(text).toMatch(/human turns\s+median 1/);
    expect(text).toMatch(/cwd missing or not a repo\s+1 of 1/);
  });
});

describe('S7 no baseline yet', () => {
  it('now and assess point at baseline add instead of failing', async () => {
    const h = await harness({ daily: dailySeries(['2026-07', '2026-08'], 0.5) });
    expect(await runNow(h.ctx, { all: true }, h.deps)).toBe(0);
    expect(strip(h.out.join('\n'))).toContain('none recorded (decadra baseline add)');
    h.out.length = 0;
    expect(await runAssess(h.ctx, { months: 3, provider: ['anthropic-claude-code'] }, h.deps)).toBe(0);
    expect(strip(h.out.join('\n'))).toMatch(/no baseline snapshot for this provider; record one with decadra baseline add/);
  });
});

describe('S10 scripted use', () => {
  it('json output is parseable and carries no escape codes', async () => {
    const h = await harness();
    h.ctx.format = 'json';
    await runAssess(h.ctx, { months: 1 }, h.deps);
    const raw = h.out[0] as string;
    // eslint-disable-next-line no-control-regex
    expect(raw).not.toMatch(/\x1b\[/);
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual([...REPORT_TOP_LEVEL_KEYS].sort());
  });
});
