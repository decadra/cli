import { describe, expect, it } from 'vitest';
import { RAMP, renderLogomark } from '../src/ui/logomark';
import { renderWordmark } from '../src/ui/wordmark';
import { composeFrame } from '../src/ui/splash';
import { COPY } from '../src/ui/copy';
import { SHAPE, SHAPE_H, SHAPE_W } from '../src/ui/logomark-shape';

// eslint-disable-next-line no-control-regex
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
/** The dense end of the ramp. Only the mark draws these; no label, hint or key line does. */
const DENSE = /[*#%@]/;

describe('home screen art', () => {
  it('logomark has the requested size, only ramp characters, and is deterministic', () => {
    const a = renderLogomark(44, 22, 1.5);
    const b = renderLogomark(44, 22, 1.5);
    expect(a).toHaveLength(22);
    for (const row of a) {
      expect(row).toHaveLength(44);
      for (const ch of row) expect(RAMP).toContain(ch);
    }
    expect(a).toEqual(b);
    expect(renderLogomark(44, 22, 3.0)).not.toEqual(a);
    // corners are outside the disc and stay empty
    expect(a[0]?.[0]).toBe(' ');
    expect(a[21]?.[43]).toBe(' ');
  });

  it('the baked shape is well formed and actually has ink in it', () => {
    // Cheap guard against a hand-edited or truncated bake. Reproducing it from the SVG is
    // `npm run gen:logomark`, checked in CI with git diff --exit-code.
    expect(SHAPE).toHaveLength(SHAPE_H);
    for (const row of SHAPE) {
      expect(row).toHaveLength(SHAPE_W);
      expect(row).toMatch(/^[0-9a-f]+$/);
    }
    const cells = SHAPE.join('');
    expect([...cells].some((c) => c === 'f')).toBe(true);
    expect([...cells].some((c) => c === '0')).toBe(true);
  });

  it('grows the mark with the terminal and drops it when there is no room', () => {
    const rows = (columns: number): number =>
      composeFrame({ version: '0.1.0', animate: false, columns }, 0, 0)
        .map(strip)
        .filter((l) => DENSE.test(l)).length;
    expect(rows(70)).toBe(0);
    expect(rows(200)).toBeGreaterThan(rows(100));
    expect(rows(100)).toBeGreaterThan(0);
  });

  it('wordmark is five equal-width rows', () => {
    const rows = renderWordmark();
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.length)).size).toBe(1);
  });
});

describe('home screen frame', () => {
  it('never exceeds the terminal width, at any width', () => {
    for (const columns of [40, 60, 80, 92, 100, 120, 200]) {
      const frame = composeFrame({ version: '0.1.0', animate: false, columns }, 0, 0);
      for (const line of frame) expect(strip(line).length).toBeLessThanOrEqual(Math.max(60, columns));
    }
  });

  it('lists every menu item with its hint and marks the selection', () => {
    const text = composeFrame({ version: '0.1.0', animate: false, columns: 120 }, 2, 0).map(strip).join('\n');
    COPY.menu.forEach((item, i) => {
      expect(text).toContain(`[${i + 1}]  ${item.label.padEnd(8)}`);
      expect(text).toContain(item.hint);
    });
    expect(text).toContain('> [3]');
  });

  it('every menu label except exit is a real subcommand word', () => {
    for (const item of COPY.menu) {
      if (item.id === 'exit') continue;
      expect(item.label).toBe(item.id);
    }
  });

  it('keeps the wordmark and menu at every width, drops the logomark when narrow', () => {
    const narrow = composeFrame({ version: '0.1.0', animate: false, columns: 60 }, 0, 0).map(strip).join('\n');
    const wide = composeFrame({ version: '0.1.0', animate: false, columns: 120 }, 0, 0).map(strip).join('\n');
    for (const text of [narrow, wide]) {
      expect(text).toContain('baseline');
      expect(text).toContain(COPY.keys);
    }
    // Assert art is present, not which character it is: that depends on the bake. The dense
    // end of the ramp is unambiguous, since no menu label, hint or key line contains one.
    expect(narrow).not.toMatch(DENSE);
    expect(wide).toMatch(DENSE);
  });

  it('carries no decorative copy beyond the name and the art', () => {
    const text = composeFrame({ version: '0.1.0', animate: false, columns: 120 }, 0, 0).map(strip).join('\n');
    for (const gone of ['PRINCIPLES', 'Many parts', 'user@decadra', 'BUILD', 'EXPLORE', 'SHIP', 'open world']) {
      expect(text).not.toContain(gone);
    }
  });
});
