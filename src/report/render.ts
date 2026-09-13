import type { ProviderSection, Report } from './model';
import * as terminal from './terminal';
import * as json from './json';
import * as html from './html';

export type Format = 'terminal' | 'json' | 'html';

/**
 * The single place that iterates providers. Alphabetical by id, never by any
 * metric. Every format sees one section at a time through renderSection.
 */
export function sectionsInOrder(report: Report): ProviderSection[] {
  return Object.keys(report.providers)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => report.providers[id] as ProviderSection);
}

export function renderReport(report: Report, format: Format): string {
  const sections = sectionsInOrder(report);
  switch (format) {
    case 'terminal':
      return terminal.assemble(report, sections.map((s) => terminal.renderSection(s)));
    case 'json':
      return json.assemble(report, sections.map((s) => [s.provider, json.renderSection(s)] as const));
    case 'html':
      return html.assemble(report, sections.map((s) => html.renderSection(s)));
  }
}
