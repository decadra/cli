import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeFound, offerSetupOnFirstRun, runSetup, setupPlan, survey, type Choice } from '../src/commands/setup';
import { CliError } from '../src/commands/context';
import { loadPlans, ensurePlans } from '../src/config/plans';
import { loadSettings, updateSettings } from '../src/config/settings';
import { addBaseline, listBaseline } from '../src/store/baseline';
import { builtinAdapters } from '../src/providers/registry';
import { harness, strip } from './harness';

const choice = (provider: string, tier: string, price: number): Choice => ({ provider, tier, product: tier, price, billing: 'monthly' });

describe('setup, the parts that do not need a terminal', () => {
  it('turns answers into snapshots and a visibility list', () => {
    const planned = setupPlan([choice('openai-codex', 'plus', 20), choice('anthropic-claude-code', 'max20', 200)], '2026-09-07');
    expect(planned.show).toEqual(['anthropic-claude-code', 'openai-codex']);
    expect(planned.baselines.map((b) => b.provider).sort()).toEqual(['anthropic-claude-code', 'openai-codex']);
    for (const b of planned.baselines) {
      expect(b.asOf).toBe('2026-09-07');
      expect(b.currency).toBe('USD');
      expect(b.billing).toBe('monthly');
    }
  });

  it('leaves visibility on auto when you say you pay for nothing', () => {
    // A list of none would blank every report until the user came back and fixed it.
    expect(setupPlan([], '2026-09-07')).toEqual({ baselines: [], show: 'auto' });
  });

  it('reports what is on the machine and what is already recorded', async () => {
    const h = await harness();
    await ensurePlans(h.ctx.paths);
    const plans = await loadPlans(h.ctx.paths);
    await mkdir(join(h.deps.env.home, '.claude', 'projects', 'p'), { recursive: true });
    await writeFile(join(h.deps.env.home, '.claude', 'projects', 'p', 'a.jsonl'), '{}\n');
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-08-01', provider: 'openai-codex', product: 'Plus', tier: 'plus', price: 20, currency: 'USD', billing: 'monthly' });
    const { records } = await listBaseline(h.ctx.paths.baseline);

    const found = await survey(builtinAdapters, plans, records, h.deps.env);
    const claude = found.find((f) => f.id === 'anthropic-claude-code');
    const codex = found.find((f) => f.id === 'openai-codex');
    const cursor = found.find((f) => f.id === 'cursor');
    expect(claude?.dataSince).not.toBeNull();
    expect(codex?.held?.tier).toBe('plus');
    expect(cursor?.dataSince).toBeNull();
    expect(cursor?.held).toBeNull();
    expect(claude?.plans.length).toBeGreaterThan(0);

    expect(strip(describeFound(claude!))).toContain('usage data since');
    expect(strip(describeFound(codex!))).toContain('recorded: plus');
    expect(strip(describeFound(cursor!))).toContain('nothing found');
  });

  it('refuses to run where a prompt would corrupt the output', async () => {
    const h = await harness();
    h.ctx.format = 'json';
    await expect(runSetup(h.ctx, { interactive: true }, { env: h.deps.env })).rejects.toBeInstanceOf(CliError);
  });
});

describe('the first-run offer', () => {
  it('does not ask again once it has been answered', async () => {
    // If this ever asked, the test would hang rather than fail, which is the point.
    const h = await harness();
    await updateSettings(h.ctx.paths, { setupOfferedAt: '2026-09-01T00:00:00.000Z' });
    await offerSetupOnFirstRun(h.ctx, { env: h.deps.env, now: h.deps.now });
    expect((await loadSettings(h.ctx.paths)).setupOfferedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('does not ask someone who has already recorded a subscription', async () => {
    const h = await harness();
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-08-01', provider: 'openai-codex', product: 'Plus', tier: 'plus', price: 20, currency: 'USD', billing: 'monthly' });
    await offerSetupOnFirstRun(h.ctx, { env: h.deps.env, now: h.deps.now });
    expect((await loadSettings(h.ctx.paths)).setupOfferedAt).toBeNull();
  });
});
