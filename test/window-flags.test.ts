import { describe, expect, it } from 'vitest';
import { resolveWindow } from '../src/commands/assess';
import { formatAmount, meterLabel, meterNoun } from '../src/analysis/units';
import { CliError } from '../src/commands/context';

const TODAY = '2026-09-06';

describe('--since and --until', () => {
  it('counts the window back from --until, not from today', () => {
    // Asking about a window that ended in July must not return a window ending today.
    const w = resolveWindow({ until: '2026-07-31', months: 2 }, TODAY);
    expect(w.until).toBe('2026-07-31');
    expect(w.since).toBe('2026-06-01');
  });

  it('honours --since on its own and both together', () => {
    expect(resolveWindow({ since: '2026-08-01' }, TODAY)).toMatchObject({ since: '2026-08-01', until: TODAY });
    expect(resolveWindow({ since: '2026-07-10', until: '2026-08-20' }, TODAY)).toMatchObject({ since: '2026-07-10', until: '2026-08-20' });
  });

  it('falls back to whole months when neither is given', () => {
    expect(resolveWindow({ months: 3 }, TODAY)).toMatchObject({ since: '2026-07-01', until: TODAY, months: 3 });
  });

  it('rejects a date that is not YYYY-MM-DD, and a reversed range', () => {
    expect(() => resolveWindow({ since: 'last tuesday' }, TODAY)).toThrow(CliError);
    expect(() => resolveWindow({ until: '2026-9-6' }, TODAY)).toThrow(/YYYY-MM-DD/);
    expect(() => resolveWindow({ since: '2026-08-01', until: '2026-07-01' }, TODAY)).toThrow(/must not be after/);
  });
});

describe('meter units', () => {
  it('formats an amount in the provider own unit and never converts between them', () => {
    expect(formatAmount('usd-list', 12.5)).toBe('$12.50');
    expect(formatAmount('usd-billed', 12.5)).toBe('$12.50');
    expect(formatAmount('acu', 12.5)).toBe('12.5 ACU');
  });

  it('names the unit consistently for both the readout and the assessment', () => {
    expect(meterLabel('usd-list')).toBe('list-equivalent');
    expect(meterLabel('acu')).toBe('ACU');
    expect(meterNoun('usd-billed')).toBe('billed usage');
  });
});
