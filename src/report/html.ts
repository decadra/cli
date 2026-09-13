import type { Block, ProviderSection, Report } from './model';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderBlock(b: Block): string {
  switch (b.kind) {
    case 'line':
      return `<p>${esc(b.text)}</p>`;
    case 'note':
      return `<p class="note">${esc(b.text)}</p>`;
    case 'kv':
      return `<dl>${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    case 'table':
      return (
        `<table><thead><tr>${b.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>` +
        `<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      );
  }
}

/** One provider per <section>. No shared axis, no totals, no script. */
export function renderSection(section: ProviderSection): string {
  return `<section id="${esc(section.provider)}"><h2>${esc(section.displayName)} <small>${esc(section.provider)}</small></h2>${section.blocks.map(renderBlock).join('\n')}</section>`;
}

const CSS = `
:root{color-scheme:light dark;--fg:#1a1a1a;--bg:#fafaf8;--dim:#6b6b6b;--line:#d8d8d4}
@media (prefers-color-scheme:dark){:root{--fg:#e8e6e1;--bg:#111;--dim:#9a9a9a;--line:#333}}
body{margin:0;padding:2rem;background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-width:72rem}
h1{font-size:1.25rem;margin:0 0 .25rem}h2{font-size:1rem;margin:2rem 0 .5rem}small,.note,.meta{color:var(--dim)}
section{border-top:1px solid var(--line);padding-top:1rem}
table{border-collapse:collapse;margin:.5rem 0;overflow-x:auto;display:block}th,td{text-align:left;padding:.25rem .75rem .25rem 0;border-bottom:1px solid var(--line)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{color:var(--dim)}dd{margin:0}
`;

export function assemble(report: Report, rendered: string[]): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>decadra report</title><style>${CSS}</style></head><body>` +
    `<h1>decadra</h1><p class="meta">window ${esc(report.window.since)} to ${esc(report.window.until)}, UTC, generated ${esc(report.generatedAt)}</p>` +
    (report.bill ? `<p class="bill">You pay $${report.bill.monthlyUsd.toFixed(2)}/month across ${report.bill.count} subscription${report.bill.count === 1 ? '' : 's'} (baseline as of ${esc(report.bill.asOf)}). Prices only.</p>` : '') +
    rendered.join('\n') +
    `<footer>${report.caveats.map((c) => `<p class="note">${esc(c)}</p>`).join('')}</footer>` +
    `</body></html>`
  );
}
