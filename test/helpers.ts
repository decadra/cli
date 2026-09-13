import type { Report, ProviderSection } from '../src/report/model';
import { emptyReport } from '../src/report/model';

export function section(provider: string, displayName: string, usd: number, turns: number): ProviderSection {
  return {
    provider,
    displayName,
    data: { listPriceEquivalentUsd: usd, medianTurns: turns },
    blocks: [
      { kind: 'line', text: `${displayName} on observed usage: held plan fits.` },
      { kind: 'kv', rows: [['list-price equivalent', `$${usd.toFixed(2)}`], ['median turns', String(turns)]] },
      { kind: 'table', columns: ['plan', 'effective cost', 'multiple'], rows: [['pro', `$${(usd / 3).toFixed(2)}`, `${(usd / 20).toFixed(1)}x`]] },
      { kind: 'note', text: 'est. figures use your anchor times the vendor multiplier.' },
    ],
  };
}

export function twoProviderReport(reverseInsertion = false): Report {
  const r = emptyReport({ since: '2026-06-01', until: '2026-09-05', months: 3 });
  const a = section('anthropic-claude-code', 'Claude', 412.5, 14);
  const b = section('openai-codex', 'ChatGPT', 96.25, 9);
  const order = reverseInsertion ? [b, a] : [a, b];
  for (const s of order) r.providers[s.provider] = s;
  return r;
}
