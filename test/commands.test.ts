import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runAssess } from '../src/commands/assess';
import { runNow } from '../src/commands/now';
import { collectChecks } from '../src/commands/doctor';
import { addBaseline } from '../src/store/baseline';
import { REPORT_TOP_LEVEL_KEYS } from '../src/report/model';

import { harness, strip } from './harness';

describe('assess', () => {
  it('renders every provider, keeps ccusage offline, appends verdicts, and flags the zero-priced model', async () => {
    const h = await harness();
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-08-01', provider: 'anthropic-claude-code', product: 'Claude Max 20x', tier: 'max20', price: 200, currency: 'USD', billing: 'monthly' });
    const code = await runAssess(h.ctx, { months: 3 }, h.deps);
    expect(code).toBe(0);
    const text = strip(h.out.join('\n'));
    for (const n of ['Claude', 'ChatGPT', 'Cursor', 'Devin', 'Muse Code']) expect(text).toContain(n);
    expect(text).toMatch(/claude-fable-5-1/);
    expect(text).toMatch(/You pay \$200\.00\/month across 1 subscription/);
    for (const c of h.calls) {
      expect(c.since).toBe('20260701');
      expect(c.configPath?.startsWith(h.ctx.paths.cache)).toBe(true);
    }
    expect(h.calls.some((c) => c.source === 'claude' && c.report === 'blocks' && c.sessionLengthHours === 5)).toBe(true);
    const verdicts = (await readFile(h.ctx.paths.verdicts, 'utf8')).trim().split('\n');
    expect(verdicts).toHaveLength(5);
  });

  it('json output has exactly the allowed top-level keys and strict section data', async () => {
    const h = await harness();
    h.ctx.format = 'json';
    await runAssess(h.ctx, { months: 1 }, h.deps);
    const parsed = JSON.parse(h.out[0] as string) as { providers: Record<string, { data: { source: string; rows: unknown[]; months: Array<{ amount: number }>; zeroPricedModels: string[]; verdict: { direction: string } } }> };
    expect(Object.keys(parsed).sort()).toEqual([...REPORT_TOP_LEVEL_KEYS].sort());
    expect(parsed.providers['anthropic-claude-code']?.data.rows).toHaveLength(3);
    expect(parsed.providers['cursor']?.data.verdict.direction).toBe('unknown');
    const codex = parsed.providers['openai-codex']!.data;
    expect(codex.source).toBe('ccusage');
    expect(codex.months[0]?.amount).toBeCloseTo(0.2578, 4);
    expect(codex.zeroPricedModels).toEqual([]);
  });

  it('a failing provider is reported in its own section and sets exit code 1', async () => {
    const h = await harness({ failSource: 'codex' });
    const code = await runAssess(h.ctx, { months: 1 }, h.deps);
    expect(code).toBe(1);
    expect(strip(h.out.join('\n'))).toMatch(/error: ccusage codex daily failed|error: boom/);
  });

  it('writes html when asked and rejects unknown providers', async () => {
    const h = await harness();
    const file = join(h.ctx.paths.root, 'out.html');
    h.ctx.format = 'html';
    h.ctx.htmlPath = file;
    await runAssess(h.ctx, { months: 1, provider: ['anthropic-claude-code'] }, h.deps);
    expect(existsSync(file)).toBe(true);
    const html = await readFile(file, 'utf8');
    expect(html).toContain('id="anthropic-claude-code"');
    expect(html).not.toContain('id="cursor"');
    expect(html).not.toMatch(/<script/);
    await expect(runAssess(h.ctx, { provider: ['nope'] }, h.deps)).rejects.toThrow(/unknown provider/);
  });

  it('uses a multi-month synthetic series to reach a real verdict when anchors and a baseline exist', async () => {
    const daily = { daily: ['2026-07', '2026-08'].flatMap((m) => Array.from({ length: 28 }, (_, i) => ({ date: `${m}-${String(i + 1).padStart(2, '0')}`, inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 2, totalCost: 0.5, modelsUsed: ['m'], modelBreakdowns: [{ modelName: 'm', inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0.5 }] }))) };
    const h = await harness({ daily });
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-06-01', provider: 'anthropic-claude-code', product: 'Claude Max 20x', tier: 'max20', price: 200, currency: 'USD', billing: 'monthly' });
    const { writeFile } = await import('node:fs/promises');
    const { defaultPlans } = await import('../src/config/plans');
    const plans = defaultPlans();
    plans.providers['anthropic-claude-code']!.anchorApiEquivalentUsd = { short: 5, weekly: 25 };
    await writeFile(h.ctx.paths.plans, JSON.stringify(plans));
    h.ctx.format = 'json';
    await runAssess(h.ctx, { months: 3, provider: ['anthropic-claude-code'] }, h.deps);
    const parsed = JSON.parse(h.out[0] as string) as { providers: Record<string, { data: { verdict: { direction: string; bestFitPlan: string | null } } }> };
    const v = parsed.providers['anthropic-claude-code']!.data.verdict;
    expect(v.bestFitPlan).toBe('pro');
    expect(v.direction).toBe('downgrade');
  });
});

describe('now', () => {
  it('shows every provider with the bill line when no agent is detected, and exits 0', async () => {
    const h = await harness();
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-09-01', provider: 'openai-codex', product: 'ChatGPT Plus', tier: 'plus', price: 20, currency: 'USD', billing: 'monthly' });
    expect(await runNow(h.ctx, {}, h.deps)).toBe(0);
    const text = strip(h.out.join('\n'));
    expect(text).toMatch(/You pay \$20\.00\/month across 1 subscription/);
    expect(text.indexOf('Claude')).toBeLessThan(text.indexOf('ChatGPT'));
    expect(text).toContain('month to date');
  });

  it('shows only the detected provider inside an agent and matches the session from the transcript', async () => {
    const h = await harness();
    h.deps.env.env = { CLAUDECODE: '1' };
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = join(h.deps.env.home, '.claude', 'projects', '-work-proj');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2f44129c-0000-4000-8000-000000000001.jsonl'), JSON.stringify({ type: 'user', cwd: '/work/proj' }) + '\n');
    h.ctx.format = 'json';
    expect(await runNow(h.ctx, { timing: true }, h.deps)).toBe(0);
    const parsed = JSON.parse(h.out[0] as string) as { bill: unknown; providers: Record<string, { data: { detected: boolean; session: { sessionId: string; cost: number | null } | null; elapsedMs: number } }> };
    expect(Object.keys(parsed.providers)).toEqual(['anthropic-claude-code']);
    expect(parsed.bill).toBeNull();
    const d = parsed.providers['anthropic-claude-code']!.data;
    expect(d.detected).toBe(true);
    expect(d.session?.sessionId).toBe('2f44129c-0000-4000-8000-000000000001');
    expect(d.session?.cost).toBe(0);
    expect(d.elapsedMs).toBeGreaterThanOrEqual(0);
    // session report: --until is exclusive on ccusage, so the fetch asks for the day after
    expect(h.calls.find((c) => c.report === 'session')?.until).toBe('20260906');
    expect(h.calls.find((c) => c.report === 'daily')?.until).toBe('20260905');
  });

  it('matches a Codex session by the uuid in the rollout name and omits minutes without firstActivity', async () => {
    const h = await harness();
    h.deps.env.env = { CODEX_SANDBOX_NETWORK_DISABLED: '1' };
    const { mkdir, writeFile } = await import('node:fs/promises');
    // The day directory has to come from the injected clock. Building it from the real one
    // passed only while the two happened to agree, and broke the first time UTC rolled over
    // past the harness date.
    const day = h.deps.now().toISOString().slice(0, 10);
    const dir = join(h.deps.env.home, '.codex', 'sessions', day.slice(0, 4), day.slice(5, 7), day.slice(8, 10));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'rollout-2026-09-05T16-07-24-01a07365-0000-7000-8000-000000000001.jsonl'), JSON.stringify({ timestamp: 'x', type: 'session_meta', payload: { id: '01a07365-0000-7000-8000-000000000001', cwd: '/work/proj' } }) + '\n');
    h.ctx.format = 'json';
    expect(await runNow(h.ctx, {}, h.deps)).toBe(0);
    const parsed = JSON.parse(h.out[0] as string) as { providers: Record<string, { data: { session: { sessionId: string; cost: number | null; minutes: number | null } | null; today: number | null } }> };
    expect(Object.keys(parsed.providers)).toEqual(['openai-codex']);
    const d = parsed.providers['openai-codex']!.data;
    expect(d.session?.sessionId).toBe('01a07365-0000-7000-8000-000000000001');
    expect(d.session?.cost).toBeCloseTo(0.2578, 4);
    expect(d.session?.minutes).toBeNull();
    expect(d.today).toBeCloseTo(0.2578, 4);
  });

  it('still exits 0 when ccusage fails', async () => {
    const h = await harness({ failSource: 'claude' });
    expect(await runNow(h.ctx, { all: true }, h.deps)).toBe(0);
    expect(strip(h.out.join('\n'))).toMatch(/error:/);
  });
});

describe('doctor pricing checks', () => {
  it('fails on a zero-priced model and passes once modelPricing covers it', async () => {
    const h = await harness();
    let checks = await collectChecks(h.ctx, h.deps);
    const pricing = checks.find((c) => c.id === 'anthropic-claude-code.pricing');
    expect(pricing?.status).toBe('fail');
    expect(pricing?.summary).toMatch(/claude-fable-5-1/);
    const priced = { daily: [{ date: '2026-09-05', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 15, totalCost: 0.02, modelsUsed: ['claude-fable-5-1'], modelBreakdowns: [{ modelName: 'claude-fable-5-1', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0.02 }] }] };
    const h2 = await harness({ daily: priced });
    checks = await collectChecks(h2.ctx, h2.deps);
    expect(checks.find((c) => c.id === 'anthropic-claude-code.pricing')?.status).toBe('ok');
  });

  it('warns on a cache rate that sits outside any published ratio, and is quiet once it is fixed', async () => {
    const h = await harness();
    await collectChecks(h.ctx, h.deps); // plans.json is written on first run
    const withPricing = async (cacheWrite: number, cacheRead: number): Promise<void> => {
      const plans = JSON.parse(await readFile(h.ctx.paths.plans, 'utf8')) as { modelPricing: Record<string, unknown> };
      plans.modelPricing = { 'claude-fable-5-1': { input: 10, output: 50, cacheWrite, cacheRead } };
      await writeFile(h.ctx.paths.plans, JSON.stringify(plans, null, 2));
    };

    // 0.25 against an input of 10 is 2.5%, where vendors publish near 10%. Nothing else catches
    // it: the schema takes any number and the cost it produces is not $0.
    await withPricing(12.5, 0.25);
    const bad = (await collectChecks(h.ctx, h.deps)).find((c) => c.id === 'plans.modelPricing.ratios');
    expect(bad?.status).toBe('warn');
    expect(bad?.summary).toMatch(/cacheRead/);
    expect(bad?.summary).toMatch(/claude-fable-5-1/);

    await withPricing(20, 1);
    const good = (await collectChecks(h.ctx, h.deps)).find((c) => c.id === 'plans.modelPricing.ratios');
    expect(good?.status).toBe('ok');
  });

  it('warns when the cache-write rate is the wrong TTL for the writes on disk', async () => {
    const h = await harness();
    const proj = join(h.deps.env.home, '.claude', 'projects', '-home-fixture-decadra');
    await mkdir(proj, { recursive: true });
    await cp(fileURLToPath(new URL('./fixtures/claude/sessions/', import.meta.url)), proj, { recursive: true });
    await collectChecks(h.ctx, h.deps); // plans.json is written on first run
    const plans = JSON.parse(await readFile(h.ctx.paths.plans, 'utf8')) as { modelPricing: Record<string, unknown> };

    // Every write in the fixture asks for a 1-hour TTL, so the 5-minute rate is the wrong one.
    plans.modelPricing = { 'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1 } };
    await writeFile(h.ctx.paths.plans, JSON.stringify(plans, null, 2));
    const bad = (await collectChecks(h.ctx, h.deps)).find((c) => c.id === 'anthropic-claude-code.cacheWriteTtl');
    expect(bad?.status).toBe('warn');
    expect(bad?.summary).toMatch(/100% of cache writes/);
    expect(bad?.summary).toMatch(/5-minute rate for claude-fable-5-1/);

    plans.modelPricing = { 'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 20, cacheRead: 1 } };
    await writeFile(h.ctx.paths.plans, JSON.stringify(plans, null, 2));
    const good = (await collectChecks(h.ctx, h.deps)).find((c) => c.id === 'anthropic-claude-code.cacheWriteTtl');
    expect(good?.status).toBe('ok');
    expect(good?.summary).toMatch(/no model price contradicts that/);
  });

  it('says nothing about TTL when no session states a split', async () => {
    const h = await harness();
    expect((await collectChecks(h.ctx, h.deps)).find((c) => c.id === 'anthropic-claude-code.cacheWriteTtl')).toBeUndefined();
  });

  it('is quiet about ratios when no model price is set at all', async () => {
    const h = await harness();
    const c = (await collectChecks(h.ctx, h.deps)).find((x) => x.id === 'plans.modelPricing.ratios');
    expect(c?.status).toBe('ok');
    expect(c?.summary).toMatch(/no model prices set/);
  });
});
