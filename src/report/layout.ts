import pc from 'picocolors';

/**
 * Text primitives for the terminal report: aligned columns, inline bars, sparklines.
 *
 * Every figure here is drawn from one section's own numbers. A bar takes a ratio rather than a
 * value so that whoever calls it has already decided what it is a fraction of, and that decision
 * is visible at the call site. Normalizing two providers' bars to one maximum would be a shared
 * chart axis, which docs/architecture/constraints.md forbids and no structural guard can catch:
 * renderSection only ever sees one section, so the code would look correct either way.
 */

/**
 * Whether to draw with block and box characters or stay inside 7-bit ASCII. Read once, the way
 * picocolors decides colour, because a value that changed mid-render would misalign a frame that
 * was measured earlier in the same pass.
 */
export const ASCII: boolean = (() => {
  const env = process.env;
  if (env['DECADRA_ASCII']) return true;
  const locale = env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'] ?? '';
  // No locale at all is normal in a container and says nothing either way, so it is not a reason
  // to degrade. A locale that names an encoding other than UTF-8 is.
  return locale !== '' && !/utf-?8/i.test(locale);
})();

/** Colour is measured out of every width here, because a padded escape sequence misaligns a column. */
const visible = (s: string): number =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\x1b\[[0-9;]*m/g, '').length;

const FULL = '█';
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const SPARKS = '▁▂▃▄▅▆▇█';
/** The logomark's density ramp, reused so the ASCII path has one vocabulary rather than two. */
const ASCII_SPARKS = '.:-=+*#%';
export const RULE = ASCII ? '-' : '─';
const ELLIPSIS = ASCII ? '...' : '…';

/** Cut to `cells` including the mark, so a truncated cell still fits the column it is in. */
export function clip(text: string, cells: number): string {
  if (visible(text) <= cells) return text;
  return text.slice(0, Math.max(0, cells - ELLIPSIS.length)) + ELLIPSIS;
}

/** The terminal's width, floored the way the splash frame floors it. */
export function width(): number {
  return Math.max(60, process.stdout.columns ?? 100);
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * A bar `cells` wide filled to `ratio` of it. Sub-cell remainders use eighth blocks so that two
 * ratios a few percent apart do not draw the same bar; in ASCII they round, since there is no
 * partial character to round into.
 */
export function bar(ratio: number, cells: number): string {
  if (cells <= 0) return '';
  const filled = clamp01(ratio) * cells;
  if (ASCII) return '#'.repeat(Math.round(filled));
  const whole = Math.floor(filled);
  const part = EIGHTHS[Math.round((filled - whole) * 8)] ?? '';
  return (FULL.repeat(whole) + part).slice(0, cells);
}

/**
 * One character per value, each scaled against the largest in the series. A flat series draws
 * flat rather than full: with no spread there is nothing to show, and drawing it full would
 * claim a shape the numbers do not have.
 */
export function sparkline(values: number[]): string {
  const usable = values.filter((v) => Number.isFinite(v));
  if (!usable.length) return '';
  const ramp = ASCII ? ASCII_SPARKS : SPARKS;
  const max = Math.max(...usable);
  const min = Math.min(...usable);
  if (max <= 0 || max === min) return ramp[0]!.repeat(usable.length);
  return usable.map((v) => ramp[Math.min(ramp.length - 1, Math.round((v / max) * (ramp.length - 1)))]).join('');
}

/**
 * A point inside a range: where a median sits between a floor and a ceiling. Reads a distribution
 * that two numbers side by side do not, and needs no axis, since both ends are labelled in the
 * text beside it.
 */
export function spread(lo: number, mid: number, hi: number, cells: number): string {
  if (cells < 3 || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return '';
  const inner = cells - 2;
  const at = hi === lo ? 0 : Math.round(clamp01((mid - lo) / (hi - lo)) * (inner - 1));
  const line = ASCII ? '-' : '─';
  const ends = ASCII ? ['|', '|'] : ['├', '┤'];
  const dot = ASCII ? 'o' : '●';
  return ends[0]! + line.repeat(at) + dot + line.repeat(Math.max(0, inner - at - 1)) + ends[1]!;
}

export type Status = 'ok' | 'warn' | 'fail' | 'absent';

/** Two columns wide in both vocabularies, so a list of them stays aligned. */
export function glyph(status: Status): string {
  if (ASCII) return { ok: 'ok', warn: '! ', fail: 'x ', absent: '- ' }[status];
  return { ok: pc.green('✓ '), warn: pc.yellow('! '), fail: pc.red('✕ '), absent: pc.dim('· ') }[status];
}

const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - visible(s)));

/**
 * Wrap on spaces at `cells`. A single word longer than the line, which is what an absolute path
 * usually is, is left whole and allowed to run over: breaking a path mid-character makes it
 * unusable, and a path is the one thing in this output a reader copies.
 */
export function wrap(text: string, cells: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (!line) line = word;
      else if (visible(line) + 1 + visible(word) <= cells) line += ' ' + word;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

export interface ColumnOptions {
  /** Column indexes to right-align. Numbers read wrong ragged. */
  right?: number[];
  /** Cap the whole block. Defaults to the terminal width. */
  max?: number;
  gap?: number;
}

/**
 * Aligned columns with a dim header over a single rule.
 *
 * Not cli-table3: it draws a rule between every row, and there is no way to keep the one under
 * the header without the other twenty-three, because both come from the same chars entries. Two
 * dozen rules is most of what makes the current output hard to read.
 *
 * The last column absorbs whatever width is left, so a long final cell truncates rather than
 * pushing the row past the pane.
 */
export function columns(head: string[], rows: string[][], opts: ColumnOptions = {}): string {
  if (!rows.length) return '';
  const gap = opts.gap ?? 2;
  const limit = opts.max ?? width();
  const right = new Set(opts.right ?? []);
  const count = Math.max(head.length, ...rows.map((r) => r.length));

  const widths: number[] = [];
  for (let i = 0; i < count; i += 1) {
    widths.push(Math.max(visible(head[i] ?? ''), ...rows.map((r) => visible(r[i] ?? ''))));
  }

  // Give the last column only what is left. Everything before it is already as narrow as its
  // content allows, so there is nothing to take from them without hiding a value.
  const fixed = widths.slice(0, -1).reduce((t, w) => t + w + gap, 0);
  const last = widths.length - 1;
  widths[last] = Math.max(1, Math.min(widths[last] as number, limit - fixed));

  const line = (cells: string[]): string =>
    cells
      .map((c, i) => {
        const w = widths[i] as number;
        const text = clip(c, w);
        return right.has(i) ? ' '.repeat(Math.max(0, w - visible(text))) + text : pad(text, w);
      })
      .join(' '.repeat(gap))
      .trimEnd();

  const total = Math.min(limit, widths.reduce((t, w) => t + w + gap, 0) - gap);
  return [pc.dim(line(head)), pc.dim(RULE.repeat(total)), ...rows.map(line)].join('\n');
}
