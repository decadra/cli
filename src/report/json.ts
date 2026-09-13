import type { ProviderSection, Report } from './model';

export function renderSection(section: ProviderSection): unknown {
  return { provider: section.provider, displayName: section.displayName, data: section.data };
}

export function assemble(report: Report, rendered: ReadonlyArray<readonly [string, unknown]>): string {
  const providers: Record<string, unknown> = {};
  for (const [id, value] of rendered) providers[id] = value;
  const out = {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    timezone: report.timezone,
    window: report.window,
    caveats: report.caveats,
    bill: report.bill,
    providers,
  };
  return JSON.stringify(out, null, 2);
}
