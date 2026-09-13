import { afterEach, describe, expect, it } from 'vitest';
import { renderReport } from '../src/report/render';
import { CAVEATS, emptyReport } from '../src/report/model';
import { section, twoProviderReport } from './helpers';

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const lines = (s: string): string[] => strip(s).split('\n');
const widest = (s: string): number => Math.max(...lines(s).map((l) => [...l].length));

const original = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
function atWidth(columns: number | undefined, fn: () => void): void {
  Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  try {
    fn();
  } finally {
    if (original) Object.defineProperty(process.stdout, 'columns', original);
  }
}

afterEach(() => {
  if (original) Object.defineProperty(process.stdout, 'columns', original);
});

/** The longest prose the tool prints, and the reason a section can overflow a pane. */
function wordyReport() {
  const r = emptyReport({ since: '2026-06-01', until: '2026-09-05', months: 3 }, Object.values(CAVEATS));
  const s = section('anthropic-claude-code', 'Claude', 412.5, 14);
  s.blocks.push(
    { kind: 'line', text: Object.values(CAVEATS).join(' ') },
    { kind: 'kv', rows: [['months', '2026-06 $412.50 (29/31 days), 2026-07 $380.00, 2026-08 $1238.06, 2026-09 $423.11 (7/30 days)'], ['peak windows', 'short max $234.13, p95 $203.10; weekly max $855.73, p95 $835.49']] },
    { kind: 'table', columns: ['plan', 'ceiling'], rows: [['Max 20x', 'above your estimate (est.)']] },
  );
  r.providers[s.provider] = s;
  return r;
}

describe('terminal output fits its pane', () => {
  it('wraps every block kind and the caveats to the width', () => {
    for (const columns of [60, 72, 80, 100, 120, 200]) {
      atWidth(columns, () => {
        const out = renderReport(wordyReport(), 'terminal');
        expect(widest(out), `at ${columns} columns`).toBeLessThanOrEqual(columns);
      });
    }
  });

  it('falls back to a readable width when nothing reports one, as when piped', () => {
    atWidth(undefined, () => {
      expect(widest(renderReport(wordyReport(), 'terminal'))).toBeLessThanOrEqual(100);
    });
  });

  it('floors at 60 rather than shredding the output in a very narrow pane', () => {
    atWidth(20, () => {
      const out = renderReport(wordyReport(), 'terminal');
      expect(widest(out)).toBeLessThanOrEqual(60);
      expect(strip(out)).toContain('Claude');
    });
  });

  it('keeps the key column readable down the page while the value wraps', () => {
    atWidth(72, () => {
      const rendered = lines(renderReport(wordyReport(), 'terminal'));
      const monthsAt = rendered.findIndex((l) => l.startsWith('months'));
      expect(monthsAt).toBeGreaterThan(-1);
      // The line after a wrapped value is a continuation, indented past the key column.
      const next = rendered[monthsAt + 1] as string;
      expect(next).toMatch(/^ {2,}\S/);
    });
  });

  it('still renders two providers alphabetically with no line naming both and an amount', () => {
    atWidth(72, () => {
      const out = strip(renderReport(twoProviderReport(true), 'terminal'));
      expect(out.indexOf('Claude')).toBeLessThan(out.indexOf('ChatGPT'));
      for (const l of out.split('\n')) {
        if (/^You pay \$/.test(l)) continue;
        if (l.includes('Claude') && l.includes('ChatGPT')) expect(l).not.toMatch(/\$\s?\d/);
      }
    });
  });
});
