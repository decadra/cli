import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { blocksOutput, dailyOutput, monthlyOutput, normalizeDaily, normalizeSession, sessionOutput, zeroPricedModels } from '../src/ingest/ccusage.schema';

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/ccusage/${name}.json`, import.meta.url), 'utf8'));
}

describe('ccusage v20 output schemas (real captures)', () => {
  it('parses claude daily, monthly, session, blocks', async () => {
    const daily = dailyOutput.parse(await fixture('claude-daily'));
    expect(daily.daily[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const monthly = monthlyOutput.parse(await fixture('claude-monthly'));
    expect(monthly.monthly[0]?.month).toMatch(/^\d{4}-\d{2}$/);
    const session = sessionOutput.parse(await fixture('claude-session'));
    expect(session.sessions[0]?.sessionId).toBeTruthy();
    expect(session.sessions[0]?.firstActivity).toBeTruthy();
    const blocks = blocksOutput.parse(await fixture('claude-blocks'));
    expect(blocks.blocks[0]?.tokenCounts?.cacheReadInputTokens).toBeGreaterThan(0);
  });

  it('parses empty codex output', async () => {
    expect(dailyOutput.parse(await fixture('codex-daily-empty')).daily).toEqual([]);
    expect(sessionOutput.parse(await fixture('codex-session-empty')).sessions).toEqual([]);
  });

  it('flags a model that carried tokens but priced at zero', async () => {
    const daily = dailyOutput.parse(await fixture('claude-daily')).daily.map(normalizeDaily);
    expect(zeroPricedModels(daily)).toEqual(['claude-fable-5-1']);
    expect(daily[0]?.cost).toBe(0);
    const sessions = sessionOutput.parse(await fixture('claude-session')).sessions.map(normalizeSession);
    expect(sessions[0]?.firstActivity).toBeTruthy();
  });

  it('parses real codex daily and session rows: models as a record, cost at row level, no zero-price flag', async () => {
    const daily = dailyOutput.parse(await fixture('codex-daily')).daily.map(normalizeDaily);
    expect(daily[0]?.cost).toBeCloseTo(0.2578, 4);
    expect(daily[0]?.models.map((m) => [m.modelName, m.cost, m.reasoningOutputTokens])).toEqual([['gpt-5.6-sol', null, 362]]);
    expect(zeroPricedModels(daily)).toEqual([]);
    const sessions = sessionOutput.parse(await fixture('codex-session')).sessions.map(normalizeSession);
    expect(sessions[0]?.sessionId).toMatch(/^2026\/09\/05\/rollout-/);
    expect(sessions[0]?.firstActivity).toBeNull();
    // a codex row priced at zero names every model on it
    const zeroed = dailyOutput.parse({ daily: [{ date: '2026-09-05', inputTokens: 5, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 5, costUSD: 0, models: { 'gpt-x': { inputTokens: 5 } } }] }).daily.map(normalizeDaily);
    expect(zeroPricedModels(zeroed)).toEqual(['gpt-x']);
  });

  it('refuses a row that ccusage would never emit rather than reading it as no usage', () => {
    // Every one of these parsed before, as a row of zeroes with full confidence.
    const full = { date: '2026-09-05', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 15, costUSD: 0.5 };
    expect(dailyOutput.safeParse({ daily: [full] }).success).toBe(true);
    expect(dailyOutput.safeParse({ daily: [{ date: '2026-09-05' }] }).success).toBe(false);
    for (const drop of ['inputTokens', 'outputTokens', 'cacheCreationTokens', 'cacheReadTokens', 'totalTokens']) {
      const row: Record<string, unknown> = { ...full };
      delete row[drop];
      expect(dailyOutput.safeParse({ daily: [row] }).success, drop).toBe(false);
    }
    const noCost: Record<string, unknown> = { ...full };
    delete noCost['costUSD'];
    expect(dailyOutput.safeParse({ daily: [noCost] }).success).toBe(false);
  });

  it('rejects a row missing its date, and normalizes the codex cost shape', () => {
    expect(dailyOutput.safeParse({ daily: [{ inputTokens: 1 }] }).success).toBe(false);
    const codexLike = dailyOutput.parse({ daily: [{ date: '2026-09-05', inputTokens: 10, outputTokens: 5, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 15, costUSD: 0.5, models: ['gpt-5.6'] }] }).daily.map(normalizeDaily);
    expect(codexLike[0]?.cost).toBe(0.5);
    expect(codexLike[0]?.models[0]?.modelName).toBe('gpt-5.6');
    expect(zeroPricedModels(codexLike)).toEqual([]);
  });
});
