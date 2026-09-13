import { describe, expect, it } from 'vitest';
import { defaultPlans } from '../src/config/plans';
import { assessPlanFit, prorate, type MonthlyUsage } from '../src/analysis/planfit';

const plans = defaultPlans().providers;
const full = (month: string, amount: number, tokens?: MonthlyUsage['tokens']): MonthlyUsage => ({ month, amount, daysObserved: 30, daysInMonth: 30, ...(tokens ? { tokens } : {}) });

describe('plan fit: capped-window plans (Claude, ChatGPT)', () => {
  const p = plans['anthropic-claude-code']!;
  it('says unknown and asks for an anchor when there is no ceiling evidence', () => {
    const { verdict, rows } = assessPlanFit({ provider: 'anthropic-claude-code', meter: 'usd-list', plans: p.plans, heldPlan: 'max20', monthly: [full('2026-06', 412), full('2026-07', 380), full('2026-08', 455)], windowPeaks: [] });
    expect(verdict.direction).toBe('unknown');
    expect(verdict.bestFitPlan).toBeNull();
    expect(rows.find((r) => r.planId === 'max20')?.multiple).toBeCloseTo(412 / 200, 2);
    expect(verdict.evidence.join(' ')).toMatch(/anchorApiEquivalentUsd/);
    expect(verdict.confidence).toBe('high');
  });

  it('light user on Max 20x with peaks under the Pro estimate: downgrade to Pro', () => {
    const { verdict } = assessPlanFit({
      provider: 'anthropic-claude-code', meter: 'usd-list', plans: p.plans, heldPlan: 'max20',
      monthly: [full('2026-06', 15), full('2026-07', 22), full('2026-08', 18)],
      windowPeaks: [{ kind: 'short', max: 3, p95: 2 }, { kind: 'weekly', max: 9, p95: 7 }],
      anchors: { short: 5, weekly: 25 },
    });
    expect(verdict.bestFitPlan).toBe('pro');
    expect(verdict.direction).toBe('downgrade');
  });

  it('heavy user on Pro whose peaks exceed Pro and Max 5x estimates: upgrade to Max 20x', () => {
    const { verdict, rows } = assessPlanFit({
      provider: 'anthropic-claude-code', meter: 'usd-list', plans: p.plans, heldPlan: 'pro',
      monthly: [full('2026-06', 900), full('2026-07', 1100)],
      windowPeaks: [{ kind: 'short', max: 40, p95: 30 }, { kind: 'weekly', max: 180, p95: 150 }],
      anchors: { short: 5, weekly: 25 },
    });
    expect(rows.map((r) => [r.planId, r.fits])).toEqual([['pro', false], ['max5', false], ['max20', true]]);
    expect(verdict.bestFitPlan).toBe('max20');
    expect(verdict.direction).toBe('upgrade');
    expect(verdict.confidence).toBe('medium');
  });

  it('uses recorded utilization ahead of anchors, scaled by multiplier (Codex)', () => {
    const c = plans['openai-codex']!;
    const { verdict, rows } = assessPlanFit({
      provider: 'openai-codex', meter: 'usd-list', plans: c.plans, heldPlan: 'plus',
      monthly: [full('2026-07', 60), full('2026-08', 75)],
      windowPeaks: [], anchors: { short: 1, weekly: 1 },
      recordedUtilization: [{ kind: 'weekly', percent: 140, planType: 'plus' }],
    });
    expect(rows.find((r) => r.planId === 'plus')?.fits).toBe(false);
    expect(rows.find((r) => r.planId === 'pro')?.fits).toBe(true);
    expect(rows.find((r) => r.planId === 'pro')?.fitsBasis).toBe('recorded');
    expect(verdict.bestFitPlan).toBe('pro');
    expect(verdict.direction).toBe('upgrade');
  });

  it('scales each utilization sample by the plan it was recorded on', () => {
    const c = plans['openai-codex']!;
    // Recorded on Plus (multiplier 1) while Pro (multiplier 5) is held today. Scaling the
    // sample by the held plan would multiply it by five and call Plus unusable.
    const { rows } = assessPlanFit({
      provider: 'openai-codex', meter: 'usd-list', plans: c.plans, heldPlan: 'pro',
      monthly: [full('2026-07', 60), full('2026-08', 75)], windowPeaks: [],
      recordedUtilization: [{ kind: 'weekly', percent: 90, planType: 'plus' }],
    });
    const plus = rows.find((r) => r.planId === 'plus');
    expect(plus?.fits).toBe(true);
    expect(plus?.notes.join(' ')).toMatch(/90% on Plus, scaled to Plus: 90%/);
    expect(rows.find((r) => r.planId === 'pro')?.notes.join(' ')).toMatch(/scaled to Pro: 18%/);
  });

  it('takes the peak across samples recorded on different plans', () => {
    const c = plans['openai-codex']!;
    const { rows } = assessPlanFit({
      provider: 'openai-codex', meter: 'usd-list', plans: c.plans, heldPlan: 'pro',
      monthly: [full('2026-08', 75)], windowPeaks: [],
      recordedUtilization: [
        { kind: 'weekly', percent: 40, planType: 'plus' },
        { kind: 'weekly', percent: 30, planType: 'pro' },
      ],
    });
    // 30% of Pro is 150% of Plus, which beats 40% of Plus, so Plus is over its ceiling.
    expect(rows.find((r) => r.planId === 'plus')?.fits).toBe(false);
  });

  it('hold when the held plan is already the cheapest fit', () => {
    const { verdict } = assessPlanFit({
      provider: 'anthropic-claude-code', meter: 'usd-list', plans: p.plans, heldPlan: 'max5',
      monthly: [full('2026-08', 300)], windowPeaks: [{ kind: 'short', max: 20, p95: 15 }], anchors: { short: 5, weekly: null },
    });
    expect(verdict.bestFitPlan).toBe('max5');
    expect(verdict.direction).toBe('hold');
    expect(verdict.confidence).toBe('low');
  });
});

describe('plan fit: included-credit plans (Cursor)', () => {
  const c = plans['cursor']!;
  it('billed usage inside the Pro pool: hold Pro', () => {
    const { verdict, rows } = assessPlanFit({ provider: 'cursor', meter: 'usd-billed', plans: c.plans, heldPlan: 'pro', monthly: [full('2026-07', 14), full('2026-08', 19)], windowPeaks: [] });
    expect(rows.map((r) => [r.planId, r.effectiveUsdPerMonth])).toEqual([['pro', 20], ['pro-plus', 60], ['ultra', 200]]);
    expect(verdict.direction).toBe('hold');
  });
  it('overage past the point where Pro+ is cheaper: upgrade', () => {
    const { verdict, rows } = assessPlanFit({ provider: 'cursor', meter: 'usd-billed', plans: c.plans, heldPlan: 'pro', monthly: [full('2026-07', 85), full('2026-08', 95)], windowPeaks: [] });
    expect(rows.find((r) => r.planId === 'pro')?.effectiveUsdPerMonth).toBe(90);
    expect(rows.find((r) => r.planId === 'pro-plus')?.effectiveUsdPerMonth).toBe(80);
    expect(verdict.bestFitPlan).toBe('pro-plus');
    expect(verdict.direction).toBe('upgrade');
  });
});

describe('plan fit: metered plans (Devin, Muse)', () => {
  it('Devin: 40 ACU a month stays on Core, 300 ACU a month is cheaper on Team', () => {
    const d = plans['devin']!;
    const low = assessPlanFit({ provider: 'devin', meter: 'acu', plans: d.plans, heldPlan: 'core', monthly: [full('2026-08', 40)], windowPeaks: [] });
    expect(low.rows.find((r) => r.planId === 'core')?.effectiveUsdPerMonth).toBe(90);
    expect(low.verdict.direction).toBe('hold');
    const high = assessPlanFit({ provider: 'devin', meter: 'acu', plans: d.plans, heldPlan: 'core', monthly: [full('2026-08', 300)], windowPeaks: [] });
    expect(high.rows.find((r) => r.planId === 'core')?.effectiveUsdPerMonth).toBe(675);
    expect(high.rows.find((r) => r.planId === 'team')?.effectiveUsdPerMonth).toBe(600);
    expect(high.verdict.direction).toBe('upgrade');
    expect(high.verdict.evidence.join(' ')).toMatch(/ACU/);
  });
  it('a token-priced plan with no token counts is not priceable and cannot win', () => {
    const m = plans['meta-muse']!;
    // No tokens ingested: median([]) used to be 0, which made every token-priced plan
    // look free and beat everything else in the verdict.
    const { rows, verdict } = assessPlanFit({
      provider: 'meta-muse', meter: 'usd-list', plans: m.plans, heldPlan: 'standard',
      monthly: [full('2026-08', 67)], windowPeaks: [],
    });
    for (const r of rows) {
      expect(r.effectiveUsdPerMonth).toBeNull();
      expect(r.notes.join(' ')).toMatch(/cannot be priced/);
    }
    expect(verdict.bestFitPlan).toBeNull();
    expect(verdict.direction).toBe('unknown');
  });

  it('Muse: token pricing per tier, minimum applies', () => {
    const m = plans['meta-muse']!;
    const tokens = { input: 40_000_000, output: 4_000_000, cacheWrite: 0, cacheRead: 0 };
    const { rows } = assessPlanFit({ provider: 'meta-muse', meter: 'usd-list', plans: m.plans, heldPlan: 'standard', monthly: [full('2026-08', 67, tokens)], windowPeaks: [] });
    expect(rows.find((r) => r.planId === 'standard')?.effectiveUsdPerMonth).toBeCloseTo(40 * 1.25 + 4 * 4.25, 2);
    expect(rows.find((r) => r.planId === 'contributor')?.effectiveUsdPerMonth).toBeCloseTo(40 * 0.1 + 4 * 0.2, 2);
  });
});

describe('plan fit: month handling', () => {
  it('prorates a partial month by days observed', () => {
    expect(prorate({ month: '2026-09', amount: 50, daysObserved: 5, daysInMonth: 30 })).toBe(300);
    expect(prorate({ month: '2026-08', amount: 50, daysObserved: 31, daysInMonth: 31 })).toBe(50);
  });
});
