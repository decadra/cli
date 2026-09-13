import { describe, expect, it } from 'vitest';
import { renderReport, sectionsInOrder } from '../src/report/render';
import { REPORT_TOP_LEVEL_KEYS } from '../src/report/model';
import { planFitLine } from '../src/report/templates';
import { section, twoProviderReport } from './helpers';

const BANNED = /\b(switch to|cheaper than|better than|worse than|vs\.?|versus|winner|outperform\w*|rank\w*|prefer(?:red)? (?:claude|chatgpt|cursor|devin|muse))\b/i;
const NAMES = ['Claude', 'ChatGPT', 'Cursor', 'Devin', 'Muse Code'];

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

function assertClean(text: string): void {
  for (const line of strip(text).split('\n')) {
    expect(line, `banned phrase in: ${line}`).not.toMatch(BANNED);
    // The bill line is the one allowed cross-provider figure: a sum of prices paid, never usage.
    if (/^You pay \$[\d.]+\/month across \d+ subscription/.test(line)) continue;
    const names = NAMES.filter((n) => line.includes(n));
    if (names.length >= 2) expect(line, `two providers and an amount on one line: ${line}`).not.toMatch(/\$\s?\d/);
  }
}

describe('verdict guard', () => {
  it('renders every format without a cross-provider phrase or shared amount line', () => {
    const r = twoProviderReport();
    for (const f of ['terminal', 'html', 'json'] as const) assertClean(renderReport(r, f));
  });

  it('holds under fuzzed numbers', () => {
    for (let i = 0; i < 60; i += 1) {
      const r = twoProviderReport();
      r.providers['anthropic-claude-code'] = section('anthropic-claude-code', 'Claude', Math.random() * 5000, Math.floor(Math.random() * 400));
      r.providers['openai-codex'] = section('openai-codex', 'ChatGPT', Math.random() * 5000, Math.floor(Math.random() * 400));
      for (const f of ['terminal', 'html'] as const) assertClean(renderReport(r, f));
    }
  });

  it('orders providers alphabetically regardless of insertion order or any metric', () => {
    const ids = sectionsInOrder(twoProviderReport(true)).map((s) => s.provider);
    expect(ids).toEqual(['anthropic-claude-code', 'openai-codex']);
    const html = renderReport(twoProviderReport(true), 'html');
    expect(html.indexOf('id="anthropic-claude-code"')).toBeLessThan(html.indexOf('id="openai-codex"'));
  });

  it('json output has exactly the allowed top-level keys', () => {
    const out = JSON.parse(renderReport(twoProviderReport(), 'json')) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([...REPORT_TOP_LEVEL_KEYS].sort());
    expect(Array.isArray(out['providers'])).toBe(false);
  });

  it('html carries no script and no external resource', () => {
    const html = renderReport(twoProviderReport(), 'html');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('bill line is rendered from prices and never from usage', () => {
    const r = twoProviderReport();
    r.bill = { monthlyUsd: 220, count: 2, asOf: '2026-09-05' };
    const text = renderReport(r, 'terminal');
    expect(text).toMatch(/You pay \$220\.00\/month across 2 subscriptions/);
    assertClean(text);
    assertClean(renderReport(r, 'html'));
  });

  it('planFitLine mentions only the section it was given', () => {
    const s = section('openai-codex', 'ChatGPT', 10, 1);
    const line = planFitLine({
      ...s,
      data: { verdict: { provider: 'openai-codex', heldPlan: 'plus', bestFitPlan: 'pro', direction: 'upgrade', monthsOfEvidence: 3, evidence: ['3 of 3 months above 1x.'], confidence: 'medium' } },
    });
    expect(line).toContain('ChatGPT');
    for (const n of NAMES.filter((x) => x !== 'ChatGPT')) expect(line).not.toContain(n);
    assertClean(line);
  });
});
