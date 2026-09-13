import { emitKeypressEvents } from 'node:readline';
import pc from 'picocolors';
import { COPY, type MenuId } from './copy';
import { renderLogomark } from './logomark';
import { renderWordmark } from './wordmark';

export interface SplashOptions {
  version: string;
  animate: boolean;
  columns?: number;
  rows?: number;
}

/**
 * Sizes the mark may draw at, largest first. The baked grid is 192x96, so every one of these
 * is a clean step down from it. The splash takes the first that fits.
 */
const SIZES: readonly (readonly [number, number])[] = [
  [64, 32],
  [48, 24],
  [36, 18],
];
const GAP = 4;
/** Rows the frame spends on everything but the mark: title, two rules, two blanks, key hints. */
const CHROME_ROWS = 6;

function visible(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padRight(s: string, width: number): string {
  const v = visible(s);
  return v >= width ? s : s + ' '.repeat(width - v);
}

function twoColumns(left: string, right: string, width: number): string {
  const gap = Math.max(1, width - visible(left) - visible(right));
  return left + ' '.repeat(gap) + right;
}

/** Wordmark and menu. The only part of the frame that is shown at every width. */
function rightColumn(selected: number): string[] {
  const labelWidth = Math.max(...COPY.menu.map((m) => m.label.length));
  const rows: string[] = [...renderWordmark(), ''];
  COPY.menu.forEach((item, i) => {
    const on = i === selected;
    const label = item.label.padEnd(labelWidth);
    rows.push(`${on ? pc.bold('>') : ' '} [${i + 1}]  ${on ? pc.bold(label) : label}  ${pc.dim(item.hint)}`);
  });
  return rows;
}

/**
 * One frame of the home screen. The logomark grows with the terminal and is dropped entirely
 * when there is no room for it beside the menu, so no line ever exceeds the width.
 */
export function composeFrame(opts: SplashOptions, selected: number, t: number): string[] {
  const width = Math.max(60, opts.columns ?? 100);
  const right = rightColumn(selected);
  const rightWidth = Math.max(...right.map(visible));
  const lines: string[] = [
    `${pc.bold(COPY.name)} ${pc.dim(`v${opts.version}`)}`,
    pc.dim('─'.repeat(width)),
    '',
  ];

  // Widest that fits beside the menu, and short enough not to push the key hints off a short
  // pane. Deriving the threshold from rightWidth keeps the two in step if the menu grows.
  const fit = SIZES.find(
    ([w, h]) => width >= w + GAP + rightWidth && (opts.rows === undefined || opts.rows >= h + CHROME_ROWS),
  );

  if (fit) {
    const [logoW, logoH] = fit;
    const logo = renderLogomark(logoW, logoH, t);
    const top = Math.max(0, Math.floor((logoH - right.length) / 2));
    for (let i = 0; i < Math.max(logo.length, right.length + top); i += 1) {
      lines.push(padRight(logo[i] ?? '', logoW + GAP) + (right[i - top] ?? ''));
    }
  } else {
    lines.push(...right);
  }

  lines.push('', pc.dim('─'.repeat(width)), twoColumns(pc.dim(COPY.keys), pc.dim(COPY.help), width));
  return lines.map((l) => padRight(l, width));
}

/**
 * Interactive home screen. Resolves with the chosen menu id. Uses the alternate
 * screen buffer so the caller's scrollback stays clean.
 */
export function showHome(opts: SplashOptions): Promise<MenuId> {
  const out = process.stdout;
  const inp = process.stdin;
  let selected = 0;
  let t = 0;
  const started = Date.now();

  const draw = (): void => {
    const frame = composeFrame({ ...opts, columns: out.columns, rows: out.rows }, selected, t);
    out.write('\x1b[H' + frame.join('\x1b[K\n') + '\x1b[K');
  };

  return new Promise<MenuId>((resolve) => {
    out.write('\x1b[?1049h\x1b[?25l\x1b[2J');
    emitKeypressEvents(inp);
    if (inp.isTTY) inp.setRawMode(true);
    inp.resume();

    const timer = opts.animate
      ? setInterval(() => {
          t = (Date.now() - started) / 1000;
          draw();
        }, 90)
      : null;

    const finish = (id: MenuId): void => {
      if (timer) clearInterval(timer);
      inp.off('keypress', onKey);
      out.off('resize', draw);
      if (inp.isTTY) inp.setRawMode(false);
      inp.pause();
      out.write('\x1b[?25h\x1b[?1049l');
      resolve(id);
    };

    const onKey = (str: string, key: { name?: string; ctrl?: boolean }): void => {
      if (key.ctrl && key.name === 'c') return finish('exit');
      const digit = str && /^[1-9]$/.test(str) ? Number(str) - 1 : -1;
      if (digit >= 0 && digit < COPY.menu.length) {
        selected = digit;
        return finish(COPY.menu[selected]?.id ?? 'exit');
      }
      switch (key.name) {
        case 'up':
        case 'k':
          selected = (selected + COPY.menu.length - 1) % COPY.menu.length;
          break;
        case 'down':
        case 'j':
        case 'tab':
          selected = (selected + 1) % COPY.menu.length;
          break;
        case 'return':
        case 'space':
          return finish(COPY.menu[selected]?.id ?? 'exit');
        case 'q':
        case 'escape':
          return finish('exit');
        default:
          return;
      }
      draw();
    };

    inp.on('keypress', onKey);
    out.on('resize', draw);
    draw();
  });
}
