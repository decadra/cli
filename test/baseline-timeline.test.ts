import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addBaseline, billTotal, heldByMonth, heldOn, listBaseline, type BaselineInput } from '../src/store/baseline';
import { appendVerdict, lastVerdict } from '../src/store/verdicts';

const claude = (asOf: string, tier: string, price: number): BaselineInput => ({ asOf, provider: 'anthropic-claude-code', product: `Claude ${tier}`, tier, price, currency: 'USD', billing: 'monthly' });

describe('baseline timeline', () => {
  it('heldOn picks the latest snapshot on or before the date and ignores superseded and future ones', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'baseline.jsonl');
    const first = await addBaseline(file, claude('2026-06-01', 'pro', 20));
    await addBaseline(file, claude('2026-08-15', 'max20', 200));
    await addBaseline(file, claude('2026-12-01', 'max5', 100));
    await addBaseline(file, { ...claude('2026-06-01', 'max5', 100), supersedes: first.id });
    const { records } = await listBaseline(file);
    expect(heldOn(records, 'anthropic-claude-code', '2026-05-30')).toBeNull();
    expect(heldOn(records, 'anthropic-claude-code', '2026-07-01')?.tier).toBe('max5');
    expect(heldOn(records, 'anthropic-claude-code', '2026-09-05')?.tier).toBe('max20');
    expect(heldOn(records, 'openai-codex', '2026-09-05')).toBeNull();
  });

  it('heldByMonth splits a month at a plan change and billTotal sums prices only', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'baseline.jsonl');
    await addBaseline(file, claude('2026-07-01', 'pro', 20));
    await addBaseline(file, claude('2026-08-11', 'max20', 200));
    await addBaseline(file, { asOf: '2026-08-01', provider: 'openai-codex', product: 'ChatGPT Plus', tier: 'plus', price: 240, currency: 'USD', billing: 'annual' });
    const { records } = await listBaseline(file);
    const spans = heldByMonth(records, 'anthropic-claude-code', [{ month: '2026-08', daysInMonth: 31 }], '2026-08-01', '2026-08-31');
    expect(spans).toEqual([
      { month: '2026-08', planId: 'pro', days: 10 },
      { month: '2026-08', planId: 'max20', days: 21 },
    ]);

    // A window starting mid-month counts only the days inside it, so a --since of the 21st
    // bills 11 days of max20 and nothing for the plan held before the window opened.
    const partial = heldByMonth(records, 'anthropic-claude-code', [{ month: '2026-08', daysInMonth: 31 }], '2026-08-21', '2026-08-31');
    expect(partial).toEqual([{ month: '2026-08', planId: 'max20', days: 11 }]);
    expect(billTotal(records, '2026-09-05')).toEqual({ monthlyUsd: 220, count: 2, asOf: '2026-08-11' });
    expect(billTotal(records, '2026-06-01')).toBeNull();
  });

  it('verdict store appends and returns the latest per provider', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'verdicts.jsonl');
    const base = { window: { since: '2026-07-01', until: '2026-09-05', months: 3 }, plansAsOf: '2026-09-05', provider: 'cursor', heldPlan: 'pro', bestFitPlan: 'pro', direction: 'hold' as const, monthsOfEvidence: 2, evidence: [], confidence: 'medium' as const };
    await appendVerdict(file, { recordedAt: '2026-09-01T00:00:00.000Z', ...base });
    await appendVerdict(file, { recordedAt: '2026-09-05T00:00:00.000Z', ...base, direction: 'upgrade' });
    expect((await lastVerdict(file, 'cursor'))?.direction).toBe('upgrade');
    expect(await lastVerdict(file, 'devin')).toBeNull();
  });
});
