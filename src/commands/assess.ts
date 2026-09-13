import { writeFile } from 'node:fs/promises';
import { ensureRoot } from '../config/paths';
import { ensurePlans, isoDate, loadPlans, type PlansFile } from '../config/plans';
import { assessPlanFit, type PlanFitInput, type RecordedUtilization, type WindowPeak } from '../analysis/planfit';
import { formatAmount } from '../analysis/units';
import { bucketMonths, clampRange, monthsBack, todayUtc, type DateRange, type MonthBucket } from '../analysis/months';
import { shortPeak, weeklyPeak } from '../analysis/windows';
import { writeCcusageConfig } from '../ingest/ccusage-config';
import { loadOptionsFor, loadProviderUsage, type ProviderUsage } from '../ingest/usage';
import { hiddenNote, resolveAdapters, visibleProviders } from '../providers/registry';
import type { ProviderAdapter } from '../providers/types';
import { CAVEATS, emptyReport, type Block, type PlanFitVerdict, type ProviderSection, type Report } from '../report/model';
import { renderReport } from '../report/render';
import { planFitLine } from '../report/templates';
import { bar, sparkline } from '../report/layout';
import { billTotal, heldByMonth, heldOn, listBaseline, type BaselineRecord } from '../store/baseline';
import type { UtilizationSample } from '../ingest/types';
import { loadSettings } from '../config/settings';
import { appendVerdict } from '../store/verdicts';
import { assessSectionSchema, type AssessSection } from './assess.schema';
import { CliError, type CommandContext } from './context';
import { defaultDeps, type CommandDeps } from './deps';

export interface AssessOptions {
  months?: number | undefined;
  since?: string | undefined;
  until?: string | undefined;
  provider?: string[] | undefined;
  html?: string | undefined;
}


function checkDate(flag: string, value: string | undefined): void {
  if (value !== undefined && !isoDate.safeParse(value).success) throw new CliError(`${flag} must be YYYY-MM-DD, got "${value}"`);
}

export function resolveWindow(opts: AssessOptions, today: string): DateRange & { months?: number } {
  checkDate('--since', opts.since);
  checkDate('--until', opts.until);
  if (opts.since && opts.until && opts.since > opts.until) throw new CliError('--since must not be after --until');
  if (opts.since || opts.until) {
    // --until on its own asks about a window ending then, so the window is counted back
    // from --until. Counting back from today would silently return a different window.
    const until = opts.until ?? today;
    return clampRange({ since: opts.since ?? monthsBack(until, opts.months ?? 3).since, until }, today);
  }
  const n = opts.months ?? 3;
  if (!Number.isInteger(n) || n < 1) throw new CliError('--months must be a positive integer');
  return { ...monthsBack(today, n), months: n };
}

function unknownVerdict(provider: string, held: BaselineRecord | null, plans: PlansFile, reason: string): PlanFitVerdict {
  const heldName = held ? (plans.providers[provider]?.plans.find((p) => p.id === held.tier)?.name ?? held.tier) : null;
  return { provider, heldPlan: held?.tier ?? null, heldPlanName: heldName, bestFitPlan: null, bestFitPlanName: null, direction: 'unknown', monthsOfEvidence: 0, evidence: [reason], confidence: 'low' };
}

/**
 * Recorded utilization, one entry per sample, keeping the plan each was recorded on.
 * Short windows are under a day; anything longer counts as weekly. The peak is taken in
 * planfit, after each sample has been scaled by its own plan.
 */
export function utilizationSamples(samples: UtilizationSample[]): RecordedUtilization[] {
  return samples.map((s) => ({
    kind: s.windowMinutes !== null && s.windowMinutes < 24 * 60 ? ('short' as const) : ('weekly' as const),
    percent: s.usedPercent,
    planType: s.planType,
  }));
}

/** Peak percent per window kind, for the note that reports what was observed. */
export function utilizationPeaks(samples: RecordedUtilization[]): { short?: number; weekly?: number } {
  const out: { short?: number; weekly?: number } = {};
  for (const s of samples) out[s.kind] = Math.max(out[s.kind] ?? 0, s.percent);
  return out;
}

export function buildAssessSection(adapter: ProviderAdapter, plans: PlansFile, usage: ProviderUsage, window: DateRange, baseline: BaselineRecord[], recorded?: RecordedUtilization[] | undefined): ProviderSection<AssessSection> {
  // Usage figures print in this provider's own meter unit. Subscription prices are always
  // dollars, so they are formatted separately.
  const amount = (n: number): string => formatAmount(adapter.meter, n);
  const pp = plans.providers[adapter.id];
  const planList = pp?.plans ?? [];
  const held = heldOn(baseline, adapter.id, window.until);
  const heldTierKnown = held ? planList.some((p) => p.id === held.tier) : false;
  const blocks: Block[] = [];
  const notes: string[] = [];

  let months: MonthBucket[] = [];
  let peaks: WindowPeak[] = [];
  let verdict: PlanFitVerdict;
  let rows: AssessSection['rows'] = planList.map((p) => ({ planId: p.id, name: p.name, monthlyUsd: p.monthlyUsd, effectiveUsdPerMonth: p.monthlyUsd, multiple: null, fits: null, fitsBasis: 'none', notes: [] }));
  let heldChanges: string[] = [];

  if (usage.error) {
    verdict = unknownVerdict(adapter.id, held, plans, `usage could not be read: ${usage.error}`);
    notes.push(`error: ${usage.error}`);
  } else if (usage.source === 'none') {
    const how = adapter.usage.kind === 'import' ? `import (decadra import ${adapter.id} <file>)` : adapter.usage.kind === 'native' ? 'a native reader' : 'manual entry (decadra usage add)';
    verdict = unknownVerdict(adapter.id, held, plans, `no usage data for this provider yet: ${how}.`);
    notes.push(`no usage data for this provider yet: ${how}`);
  } else {
    months = bucketMonths(usage.daily.map((d) => ({ date: d.date, cost: d.cost })), window, { minDays: 7, dataStart: usage.dataStart });
    const weekly = pp?.windows.some((w) => w.kind === 'weekly' && w.effectiveFrom <= window.until) ? weeklyPeak(usage.daily.map((d) => ({ date: d.date, cost: d.cost })), window) : null;
    const short = shortPeak(usage.blocks);
    peaks = [short.peak, weekly].filter((p): p is WindowPeak => p !== null);
    if (short.activeIncluded) notes.push('the current 5-hour block is still open and is included in the short-window peak');
    if (short.peak && short.fewBlocks) notes.push('few 5-hour blocks in the window, so p95 and max may coincide');
    if (weekly) notes.push('weekly peaks are day-aligned 7-day sums, a lower bound on a true rolling window');
    const spans = heldByMonth(baseline, adapter.id, months, window.since, window.until);
    heldChanges = [...new Set(spans.map((s) => s.planId).filter((x): x is string => x !== null))];
    const excludedBeforeData = months.filter((m) => m.excluded === 'before-data').length;
    if (excludedBeforeData) notes.push(`local data begins ${usage.dataStart}; ${excludedBeforeData} month(s) of the window have no transcripts on disk and are excluded`);
    const partial = months.filter((m) => m.excluded === 'partial');
    if (partial.length) notes.push(`${partial.map((m) => m.month).join(', ')}: fewer than 7 days observed, shown but excluded from evidence`);
    if (held && !heldTierKnown) notes.push(`baseline names plan "${held.tier}" which no longer exists in plans.json`);
    const input: PlanFitInput = {
      provider: adapter.id,
      meter: adapter.meter,
      plans: planList,
      basePlan: pp?.basePlan,
      heldPlan: heldTierKnown ? (held?.tier ?? null) : null,
      monthly: months.filter((m) => m.excluded === null),
      windowPeaks: peaks,
      anchors: pp?.anchorApiEquivalentUsd ? { short: adapter.usage.kind === 'ccusage' && adapter.usage.source === 'claude' ? pp.anchorApiEquivalentUsd.short : null, weekly: pp.anchorApiEquivalentUsd.weekly } : undefined,
      heldByMonth: spans,
      recordedUtilization: recorded,
    };
    if (recorded?.length) {
      const peaks = utilizationPeaks(recorded);
      const parts = [peaks.short !== undefined ? `short ${peaks.short.toFixed(0)}%` : '', peaks.weekly !== undefined ? `weekly ${peaks.weekly.toFixed(0)}%` : ''].filter(Boolean);
      if (parts.length) notes.push(`recorded utilization from the tool's own rate-limit snapshots: ${parts.join(', ')}`);
    }
    if (input.monthly.length === 0) {
      verdict = unknownVerdict(adapter.id, held, plans, 'no month in the window has enough observed days to count as evidence.');
    } else {
      const result = assessPlanFit(input);
      rows = result.rows;
      verdict = result.verdict;
    }
  }

  const heldName = verdict.heldPlanName ?? (held?.tier ?? null);
  blocks.push({
    kind: 'kv',
    rows: [
      ['held plan', heldName ? `${heldName} (${amount(planList.find((p) => p.id === held?.tier)?.monthlyUsd ?? held?.price ?? 0)}/mo, baseline ${held?.asOf})` : 'none recorded'],
      ['months of evidence', String(verdict.monthsOfEvidence)],
      ...(months.length
        ? [
            [
              'months',
              // The shape of the series, then the series. Scaled inside this provider's own
              // months, which is the only comparison this line is entitled to make.
              `${sparkline(months.map((m) => m.amount))}  ${months.map((m) => `${m.month} ${amount(m.amount)}${m.excluded ? ` (${m.excluded})` : m.daysObserved < m.daysInMonth ? ` (${m.daysObserved}/${m.daysInMonth} days)` : ''}`).join(', ')}`,
            ] as [string, string],
          ]
        : []),
      ...(peaks.length ? [['peak windows', peaks.map((p) => `${p.kind} max ${amount(p.max)}, p95 ${amount(p.p95)}`).join('; ')] as [string, string]] : []),
      ...(heldChanges.length > 1 ? [['plans held in window', heldChanges.join(' then ')] as [string, string]] : []),
    ],
  });
  // How far past its price each plan's usage runs, drawn against the largest multiple in this
  // provider's own table. Never against another provider's: that would be a shared axis, and
  // nothing downstream could tell, because a section is rendered alone.
  const widestMultiple = Math.max(0, ...rows.map((r) => r.multiple ?? 0));
  blocks.push({
    kind: 'table',
    columns: ['plan', 'price/mo', 'effective/mo', 'multiple', '', 'ceiling'],
    rows: rows.map((r) => [
      r.name,
      `$${r.monthlyUsd.toFixed(2)}`,
      usage.source === 'ccusage' && !usage.error ? (r.effectiveUsdPerMonth === null ? 'not priceable' : amount(r.effectiveUsdPerMonth)) : '',
      r.multiple === null ? '' : `${r.multiple.toFixed(1)}x`,
      r.multiple === null || widestMultiple <= 0 ? '' : bar(r.multiple / widestMultiple, 12),
      r.fitsBasis === 'not-capped' ? 'n/a' : r.fits === null ? 'no evidence' : r.fits ? (r.fitsBasis === 'recorded' ? 'fits (recorded)' : 'fits (est.)') : r.fitsBasis === 'recorded' ? 'exceeded (recorded)' : 'above your estimate (est.)',
    ]),
  });
  const data: AssessSection = {
    meter: adapter.meter,
    source: usage.source,
    window: { since: window.since, until: window.until },
    months: months.map((m) => ({ month: m.month, amount: m.amount, daysObserved: m.daysObserved, daysInMonth: m.daysInMonth, excluded: m.excluded })),
    windowPeaks: peaks.map((p) => (p.p50 === undefined ? { kind: p.kind, max: p.max, p95: p.p95 } : { kind: p.kind, max: p.max, p95: p.p95, p50: p.p50 })),
    rows,
    verdict,
    zeroPricedModels: usage.zeroPricedModels,
    dataStart: usage.dataStart,
    heldPlanChanges: heldChanges,
    error: usage.error,
  };
  const section: ProviderSection<AssessSection> = { provider: adapter.id, displayName: adapter.displayName, data, blocks };
  blocks.push({ kind: 'line', text: planFitLine({ ...section, data: { verdict } }) });
  if (usage.zeroPricedModels.length) {
    notes.push(`priced at $0 with tokens present: ${usage.zeroPricedModels.join(', ')}. Add each to modelPricing in plans.json with all four prices; cost figures above are understated until then`);
  }
  for (const n of notes) blocks.push({ kind: 'note', text: n });
  assessSectionSchema.parse(data);
  return section;
}

export async function runAssess(ctx: CommandContext, opts: AssessOptions, deps?: CommandDeps): Promise<number> {
  const d = deps ?? (await defaultDeps(ctx));
  await ensureRoot(ctx.paths);
  await ensurePlans(ctx.paths);
  const plans = await loadPlans(ctx.paths);
  const today = todayUtc(d.now());
  const window = resolveWindow(opts, today);
  const adapters = resolveAdapters(plans);
  const wanted = opts.provider?.length ? opts.provider : null;
  if (wanted) for (const id of wanted) if (!adapters.some((a) => a.id === id)) throw new CliError(`unknown provider ${id}; known: ${adapters.map((a) => a.id).join(', ')}`);
  const config = await writeCcusageConfig(ctx.paths, plans.modelPricing);
  const { records } = await listBaseline(ctx.paths.baseline);
  const settings = await loadSettings(ctx.paths);
  // Naming a provider is asking for it by name, so --provider overrides visibility entirely.
  const visible = wanted
    ? new Set(wanted)
    : await visibleProviders(adapters, settings.providers.show, new Set(records.map((r) => r.provider)), d.env);
  const hidden = wanted ? [] : adapters.filter((a) => !visible.has(a.id));

  const report: Report<AssessSection> = { ...emptyReport(window, [CAVEATS.listPrice, CAVEATS.ceilingEstimate, CAVEATS.perProvider, CAVEATS.bill]), generatedAt: d.now().toISOString(), bill: billTotal(records, window.until), providers: {} };
  if (hidden.length) report.caveats.push(hiddenNote(hidden, settings.providers.show));
  let failed = false;
  // Providers do not depend on each other, so they are gathered at once. Verdicts are
  // appended afterwards, in adapter order, because the store is a single append-only file.
  const built = await Promise.all(
    adapters
      .filter((adapter) => visible.has(adapter.id))
      .map(async (adapter) => {
        const usage = await loadProviderUsage(adapter, window, loadOptionsFor(adapter, plans.providers[adapter.id], window, false, true), { runCcusage: d.runCcusage, now: d.now, configPath: config.path }, d.env);
        let recorded: RecordedUtilization[] | undefined;
        if (adapter.sessions?.providesUtilization && usage.source === 'ccusage' && !usage.error) {
          try {
            const read = await adapter.sessions.read({ since: window.since, until: window.until, idleGapMinutes: settings.idleGapMinutes }, d.env);
            recorded = utilizationSamples(read.utilization);
          } catch {
            recorded = undefined;
          }
        }
        const section = buildAssessSection(adapter, plans, usage, window, records, recorded);
        if (config.skipped.length && usage.source === 'ccusage') section.blocks.push({ kind: 'note', text: `modelPricing entries skipped for missing prices: ${config.skipped.join(', ')}` });
        return { section, error: usage.error };
      }),
  );
  for (const { section, error } of built) {
    if (error) failed = true;
    report.providers[section.provider] = section;
    await appendVerdict(ctx.paths.verdicts, { recordedAt: report.generatedAt, window, plansAsOf: plans.asOf, ...section.data.verdict });
  }

  if (ctx.format === 'html' && ctx.htmlPath) {
    await writeFile(ctx.htmlPath, renderReport(report, 'html'));
    ctx.write(`wrote ${ctx.htmlPath}`);
  } else {
    ctx.write(renderReport(report, ctx.format === 'json' ? 'json' : 'terminal'));
  }
  return failed ? 1 : 0;
}
