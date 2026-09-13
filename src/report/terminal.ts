import pc from 'picocolors';
import { columns, width, wrap } from './layout';
import type { Block, ProviderSection, Report } from './model';

/** Columns holding only figures read wrong ragged, so they are set to the right. */
function numericColumns(head: string[], rows: string[][]): number[] {
  const figure = /^[$\s]*[\d,.]+\s*(x|%|m|k|M|ACU)?$/;
  return head.map((_, i) => i).filter((i) => rows.some((r) => r[i]) && rows.every((r) => !r[i] || figure.test(r[i] as string)));
}

function renderBlock(b: Block): string {
  const w = width();
  switch (b.kind) {
    case 'line':
      return wrap(b.text, w).join('\n');
    case 'note':
      return pc.dim(wrap(b.text, w).join('\n'));
    case 'kv': {
      const keyWidth = Math.max(...b.rows.map(([k]) => k.length));
      // Continuation sits under the value, not under the key, so the key stays a column that can
      // be read down. A value may also arrive with newlines of its own; wrap keeps them.
      const indent = ' '.repeat(keyWidth + 2);
      const room = Math.max(20, w - indent.length);
      return b.rows.map(([k, v]) => `${pc.dim(k.padEnd(keyWidth))}  ${wrap(v, room).join('\n' + indent)}`).join('\n');
    }
    case 'table':
      return columns(b.columns, b.rows, { right: numericColumns(b.columns, b.rows), max: w });
  }
}

/** Renders exactly one provider. It has no access to any other section. */
export function renderSection(section: ProviderSection): string {
  const head = pc.bold(section.displayName) + pc.dim(`  (${section.provider})`);
  return [head, ...section.blocks.map(renderBlock)].join('\n');
}

export function billLine(bill: Report['bill']): string {
  if (!bill) return '';
  return `You pay $${bill.monthlyUsd.toFixed(2)}/month across ${bill.count} subscription${bill.count === 1 ? '' : 's'} (baseline as of ${bill.asOf}). Prices only.`;
}

export function assemble(report: Report, rendered: string[]): string {
  const w = width();
  const header = pc.dim(wrap(`window ${report.window.since} to ${report.window.until}, UTC, generated ${report.generatedAt}`, w).join('\n'));
  // Caveats are the longest prose in the output and are assembled here rather than as blocks, so
  // they need wrapping of their own. Continuation is indented under the text, past "note: ".
  const NOTE = 'note: ';
  const under = ' '.repeat(NOTE.length);
  const caveats = report.caveats.map((c) => {
    const [first, ...rest] = wrap(`${NOTE}${c}`, w);
    // Continuation carries the indent, so it has that much less room than the first line.
    return pc.dim([first, ...wrap(rest.join(' '), Math.max(20, w - NOTE.length)).map((l) => under + l)].filter((l) => l !== '').join('\n'));
  });
  const bill = report.bill ? [wrap(billLine(report.bill), w).join('\n'), ''] : [];
  return [header, ...bill, '', ...rendered.flatMap((r) => [r, '']), ...caveats].join('\n');
}
