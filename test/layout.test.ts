import { describe, expect, it } from 'vitest';
import { ASCII, bar, clip, columns, glyph, sparkline, spread, wrap } from '../src/report/layout';
import { formatMinutes } from '../src/analysis/units';

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const widest = (s: string): number => Math.max(...strip(s).split('\n').map((l) => l.length));

describe('bar', () => {
  it('never draws wider than it was asked for, at any ratio', () => {
    for (const cells of [1, 5, 20, 60]) {
      for (const r of [0, 0.001, 0.33, 0.5, 0.999, 1]) expect([...bar(r, cells)].length, `${r} of ${cells}`).toBeLessThanOrEqual(cells);
    }
  });

  it('grows with the ratio and never shrinks', () => {
    let last = -1;
    for (let r = 0; r <= 1.0001; r += 0.05) {
      const n = [...bar(r, 20)].length;
      expect(n, `ratio ${r.toFixed(2)}`).toBeGreaterThanOrEqual(last);
      last = n;
    }
    expect([...bar(1, 20)].length).toBe(20);
    expect(bar(0, 20)).toBe('');
  });

  it('treats a ratio outside 0..1 and a non-finite one as the nearest sane thing', () => {
    expect([...bar(5, 10)].length).toBe(10);
    expect(bar(-1, 10)).toBe('');
    expect(bar(NaN, 10)).toBe('');
    expect(bar(0.5, 0)).toBe('');
    expect(bar(0.5, -3)).toBe('');
  });

  it('separates two ratios a few percent apart', () => {
    // The reason for eighth blocks: 6.2x and 12.4x of the same maximum must not draw alike.
    if (ASCII) return;
    expect(bar(6.2 / 61.9, 20)).not.toBe(bar(12.4 / 61.9, 20));
  });
});

describe('sparkline', () => {
  it('draws one character per value', () => {
    expect([...sparkline([1, 2, 3])].length).toBe(3);
    expect([...sparkline([900.3, 1238.06, 423.11])].length).toBe(3);
  });

  it('draws a flat series flat rather than full', () => {
    // A run of identical values has no shape; drawing it full would claim one.
    const flat = sparkline([5, 5, 5]);
    expect(new Set([...flat]).size).toBe(1);
    expect(flat).not.toContain('█');
  });

  it('survives an empty series, a single value, zeros, and a non-finite entry', () => {
    expect(sparkline([])).toBe('');
    expect([...sparkline([42])].length).toBe(1);
    expect([...sparkline([0, 0])].length).toBe(2);
    expect([...sparkline([1, NaN, 3])].length).toBe(2);
  });

  it('puts the tallest character on the largest value', () => {
    const s = [...sparkline([1, 100, 50])];
    expect(s[1]).not.toBe(s[0]);
    expect(s.indexOf(s[1] as string)).toBe(1);
  });
});

describe('spread', () => {
  it('is exactly as wide as asked and moves the marker with the median', () => {
    const lo = spread(0, 0, 100, 20);
    const hi = spread(0, 100, 100, 20);
    expect([...lo].length).toBe(20);
    expect([...hi].length).toBe(20);
    expect(lo).not.toBe(hi);
  });

  it('refuses to draw where there is no room or no range', () => {
    expect(spread(0, 1, 2, 2)).toBe('');
    expect(spread(0, 1, NaN, 20)).toBe('');
    expect(spread(10, 5, 0, 20)).toBe('');
    expect([...spread(5, 5, 5, 10)].length).toBe(10);
  });
});

describe('glyph', () => {
  it('is two columns wide for every status, so a list of them stays aligned', () => {
    for (const s of ['ok', 'warn', 'fail', 'absent'] as const) expect(strip(glyph(s)).length, s).toBe(2);
  });
});

describe('columns', () => {
  const head = ['plan', 'price/mo', 'multiple'];
  const rows = [
    ['Pro', '$20.00', '61.9x'],
    ['Max 5x', '$100.00', '12.4x'],
    ['Max 20x', '$200.00', '6.2x'],
  ];

  it('draws one rule under the header and none between rows', () => {
    const out = strip(columns(head, rows));
    const lines = out.split('\n');
    expect(lines).toHaveLength(5); // header, rule, three rows
    expect(lines[1]).toMatch(/^[-─]+$/);
    for (const l of lines.slice(2)) expect(l).not.toMatch(/^[-─]+$/);
  });

  it('never exceeds the width it was given, however long a cell is', () => {
    const long = [['x', 'y', 'a'.repeat(400)]];
    for (const max of [60, 80, 120]) expect(widest(columns(head, long, { max })), `max ${max}`).toBeLessThanOrEqual(max);
  });

  it('truncates rather than wrapping, and marks that it did', () => {
    const out = strip(columns(['a'], [['b'.repeat(200)]], { max: 40 }));
    expect(out.split('\n')[2]).toMatch(ASCII ? /\.\.\.$/ : /…$/);
  });

  it('aligns the columns asked for to the right', () => {
    const out = strip(columns(head, rows, { right: [1, 2] })).split('\n');
    const at = (l: string): number => l.indexOf('$') + l.slice(l.indexOf('$')).length;
    expect(at(out[2] as string)).toBe(at(out[3] as string));
  });

  it('measures colour out of the width', () => {
    const plain = columns(['a'], [['bb']]);
    const painted = columns(['a'], [['[32mbb[39m']]);
    expect(widest(painted)).toBe(widest(plain));
  });

  it('returns nothing for no rows, and tolerates a short row', () => {
    expect(columns(head, [])).toBe('');
    expect(() => columns(head, [['only']])).not.toThrow();
  });
});

describe('the ascii vocabulary', () => {
  it('stays inside 7-bit when it is the one in use', () => {
    // The suite runs in whichever mode the environment selects; assert the active one is coherent.
    const sample = [bar(0.5, 10), sparkline([1, 2, 3]), spread(0, 5, 10, 12), ...(['ok', 'warn', 'fail', 'absent'] as const).map(glyph)].join('');
    const seventBit = ![...strip(sample)].some((c) => c.charCodeAt(0) > 127);
    expect(seventBit).toBe(ASCII);
  });
});

describe('wrap', () => {
  it('breaks on spaces at the width given', () => {
    const lines = wrap('one two three four five six seven eight', 12);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
    expect(lines.join(' ')).toBe('one two three four five six seven eight');
  });

  it('leaves a word longer than the line whole', () => {
    // An absolute path is one word and is the thing a reader copies; breaking it makes it useless.
    const path = '/Users/x/Library/Application/Support/Cursor/User/globalStorage/state.vscdb';
    const lines = wrap(`${path} not found`, 40);
    expect(lines[0]).toBe(path);
    expect(lines[1]).toBe('not found');
  });

  it('keeps existing newlines as breaks', () => {
    expect(wrap('a\nb', 40)).toEqual(['a', 'b']);
  });

  it('measures colour out of the width', () => {
    // Visible text is 'one two three', 13 characters, so it wraps at 12 and fits at 13. Counting
    // the escape sequences would wrap it in both cases.
    expect(wrap('\x1b[32mone two\x1b[39m three', 13)).toHaveLength(1);
    expect(wrap('\x1b[32mone two\x1b[39m three', 12)).toHaveLength(2);
  });
});

describe('clip', () => {
  it('counts the mark inside the width, so a clipped cell still fits its column', () => {
    for (const cells of [4, 10, 40]) expect([...clip('x'.repeat(200), cells)].length, `${cells}`).toBe(cells);
  });

  it('leaves text that already fits alone', () => {
    expect(clip('short', 40)).toBe('short');
    expect(clip('exactly-ten', 11)).toBe('exactly-ten');
  });

  it('marks the cut in whichever vocabulary is in use', () => {
    expect(clip('y'.repeat(50), 20).endsWith(ASCII ? '...' : '…')).toBe(true);
  });
});

describe('formatMinutes', () => {
  it('reads as a duration rather than five digits of minutes', () => {
    expect(formatMinutes(33_708)).toBe('23d 9h');
    expect(formatMinutes(151)).toBe('2h 31m');
    expect(formatMinutes(66)).toBe('1h 6m');
    expect(formatMinutes(59)).toBe('59m');
  });

  it('drops a zero remainder rather than printing it', () => {
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(1440)).toBe('1d');
    expect(formatMinutes(0)).toBe('0m');
  });

  it('never prints a third unit or a negative', () => {
    for (const m of [1, 61, 1441, 100_000, 1_000_000]) expect(formatMinutes(m).split(' ').length, `${m}`).toBeLessThanOrEqual(2);
    expect(formatMinutes(-5)).toBe('0m');
    expect(formatMinutes(NaN)).toBe('0m');
  });
});
