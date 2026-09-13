import { ensureRoot } from '../config/paths';
import { ensurePlans, loadPlans } from '../config/plans';
import { loadSettings } from '../config/settings';
import { daysBetweenInclusive, daysInMonth, todayUtc, type DateRange } from '../analysis/months';
import { projectMonth } from '../analysis/pace';
import { writeCcusageConfig } from '../ingest/ccusage-config';
import { loadOptionsFor, loadProviderUsage } from '../ingest/usage';
import { hiddenNote, resolveAdapters, visibleProviders } from '../providers/registry';
import { CAVEATS, emptyReport, type Block, type ProviderSection, type Report } from '../report/model';
import { renderReport } from '../report/render';
import { billTotal, heldOn, listBaseline } from '../store/baseline';
import { lastVerdict } from '../store/verdicts';
import { detectAgent, findCurrentSession, type AgentKind } from '../ui/agent-env';
import { formatAmount, meterLabel } from '../analysis/units';
import { utilizationPeaks, utilizationSamples } from './assess';
import { CliError, type CommandContext } from './context';
import { defaultDeps, type CommandDeps } from './deps';
import { nowSectionSchema, type NowSection } from './now.schema';

export interface NowOptions {
  all?: boolean | undefined;
  provider?: string | undefined;
  timing?: boolean | undefined;
}

const price = (n: number): string => `$${n.toFixed(2)}`;

/**
 * The in-session money meter. One block for the detected provider, or all of
 * them. Always exits 0 so a `!decadra now` never reads as a failure to the agent.
 */
export async function runNow(ctx: CommandContext, opts: NowOptions, deps?: CommandDeps): Promise<number> {
  const started = Date.now();
  const d = deps ?? (await defaultDeps(ctx));
  await ensureRoot(ctx.paths);
  await ensurePlans(ctx.paths);
  const plans = await loadPlans(ctx.paths);
  const settings = await loadSettings(ctx.paths);
  const today = todayUtc(d.now());
  const month = today.slice(0, 7);
  const range: DateRange = { since: `${month}-01`, until: today };
  const adapters = resolveAdapters(plans);
  const detected: AgentKind = detectAgent(d.env.env);
  const forced = opts.provider ?? null;
  if (forced && !adapters.some((a) => a.id === forced)) throw new CliError(`unknown provider ${forced}; known: ${adapters.map((a) => a.id).join(', ')}`);
  const showAll = opts.all || (!forced && !detected);
  const config = await writeCcusageConfig(ctx.paths, plans.modelPricing);
  const { records } = await listBaseline(ctx.paths.baseline);
  // The provider you are sitting inside is always shown. Visibility only trims the survey.
  const current = forced ?? detected;
  const visible = await visibleProviders(adapters, settings.providers.show, new Set(records.map((r) => r.provider)), d.env);
  if (current) visible.add(current);
  const targets = adapters.filter((a) => (showAll ? visible.has(a.id) : a.id === current));
  const hidden = showAll ? adapters.filter((a) => !visible.has(a.id)) : [];

  const report: Report<NowSection> = { ...emptyReport(range, [CAVEATS.readout]), generatedAt: d.now().toISOString(), bill: showAll ? billTotal(records, today) : null, providers: {} };
  if (report.bill) report.caveats.push(CAVEATS.bill);
  if (hidden.length) report.caveats.push(hiddenNote(hidden, settings.providers.show));

  // Providers are independent, and the ! path is measured in hundreds of milliseconds.
  // Run them at once and time each one from its own start, not from the start of the command.
  const sections = await Promise.all(
    targets.map(async (adapter): Promise<ProviderSection<NowSection>> => {
    const providerStarted = Date.now();
    const isCurrent = adapter.id === current;
    const usage = await loadProviderUsage(adapter, range, loadOptionsFor(adapter, plans.providers[adapter.id], range, isCurrent, false), { runCcusage: d.runCcusage, now: d.now, configPath: config.path }, d.env);
    const held = heldOn(records, adapter.id, today);
    const plan = held ? (plans.providers[adapter.id]?.plans.find((p) => p.id === held.tier) ?? null) : null;
    const dim = daysInMonth(month);
    const observed = daysBetweenInclusive(range.since, today);

    let session: NowSection['session'] = null;
    if (isCurrent && usage.source === 'ccusage' && !usage.error) {
      const cur = await findCurrentSession((forced as AgentKind) ?? detected, d.cwd, d.env, d.now());
      if (cur) {
        const row = usage.sessions.find((s) => s.sessionId === cur.sessionId || cur.sessionId.includes(s.sessionId) || s.sessionId.includes(cur.sessionId)) ?? null;
        const minutes = row?.firstActivity ? Math.round((Date.parse(row.lastActivity) - Date.parse(row.firstActivity)) / 60_000) : null;
        session = { sessionId: cur.sessionId, cost: row ? row.cost : null, minutes, quality: cur.quality };
      }
    }

    const todayCost = usage.source === 'ccusage' && !usage.error ? usage.daily.filter((r) => r.date === today).reduce((a, r) => a + r.cost, 0) : null;
    const mtd = usage.source === 'ccusage' && !usage.error ? usage.daily.reduce((a, r) => a + r.cost, 0) : null;
    const multiple = mtd !== null && plan && plan.monthlyUsd > 0 && plan.allowance.kind === 'capped-window' ? mtd / plan.monthlyUsd : null;
    const projected = mtd !== null ? projectMonth(mtd, observed, dim) : null;
    const anchors = plans.providers[adapter.id]?.anchorApiEquivalentUsd;

    // assess reads these snapshots from the same rollouts, so now saying "no recorded
    // utilization" for a tool that records it was a difference in the caller, not the data.
    let recordedPeaks: { short?: number; weekly?: number } | null = null;
    if (isCurrent && adapter.sessions?.providesUtilization && usage.source === 'ccusage' && !usage.error) {
      try {
        const read = await adapter.sessions.read({ since: range.since, until: range.until, idleGapMinutes: settings.idleGapMinutes }, d.env);
        const peaks = utilizationPeaks(utilizationSamples(read.utilization));
        if (peaks.short !== undefined || peaks.weekly !== undefined) recordedPeaks = peaks;
      } catch {
        recordedPeaks = null;
      }
    }

    const ceiling =
      usage.source !== 'ccusage'
        ? 'no local usage data for this provider yet'
        : recordedPeaks
          ? `recorded utilization ${[recordedPeaks.short !== undefined ? `short ${recordedPeaks.short.toFixed(0)}%` : '', recordedPeaks.weekly !== undefined ? `weekly ${recordedPeaks.weekly.toFixed(0)}%` : ''].filter(Boolean).join(', ')} on the plan held then`
          : anchors && (anchors.short !== null || anchors.weekly !== null)
            ? 'estimate available in decadra assess (est.)'
            : 'no recorded utilization; set anchorApiEquivalentUsd in plans.json for an estimate';
    const last = await lastVerdict(ctx.paths.verdicts, adapter.id);

    const data: NowSection = {
      meter: adapter.meter,
      source: usage.source,
      detected: isCurrent,
      held: { planId: plan?.id ?? held?.tier ?? null, name: plan?.name ?? held?.product ?? null, monthlyUsd: plan?.monthlyUsd ?? held?.price ?? null, asOf: held?.asOf ?? null },
      session,
      today: todayCost,
      monthToDate: mtd,
      monthMultiple: multiple,
      daysObserved: observed,
      daysInMonth: dim,
      projectedMonth: projected,
      ceiling,
      lastVerdict: last ? { direction: last.direction, confidence: last.confidence, recordedAt: last.recordedAt } : null,
      zeroPricedModels: usage.zeroPricedModels,
      error: usage.error,
      elapsedMs: Date.now() - providerStarted,
    };
    nowSectionSchema.parse(data);

    // Usage prints in this provider's meter unit; a subscription price is always dollars.
    const unit = meterLabel(adapter.meter);
    const amount = (n: number): string => formatAmount(adapter.meter, n);
    const kv: Array<[string, string]> = [];
    kv.push(['held', data.held.name ? `${data.held.name} ${data.held.monthlyUsd !== null ? price(data.held.monthlyUsd) + '/mo' : ''} (baseline ${data.held.asOf})` : 'none recorded (decadra baseline add)']);
    if (session) kv.push(['this session', `${session.cost !== null ? amount(session.cost) + ' ' + unit : 'not in ccusage yet'}${session.minutes !== null ? `, ${session.minutes} min` : ''}${session.quality === 'coarse' ? ' (session match coarse)' : ''}`]);
    if (todayCost !== null) kv.push(['today', `${amount(todayCost)} ${unit}`]);
    if (mtd !== null) kv.push(['month to date', `${amount(mtd)}${multiple !== null ? ` (${multiple.toFixed(1)}x plan price)` : ''}`]);
    if (projected !== null) kv.push(['pace', `${amount(projected)} by month end at this rate (${observed} of ${dim} days observed)`]);
    kv.push(['ceiling', ceiling]);
    kv.push(['last verdict', last ? `${last.direction}, ${last.confidence} confidence, ${last.recordedAt.slice(0, 10)}` : 'none yet (decadra assess)']);
    const blocks: Block[] = [{ kind: 'kv', rows: kv }];
    if (usage.error) blocks.push({ kind: 'note', text: `error: ${usage.error}` });
    if (usage.source === 'none') blocks.push({ kind: 'note', text: 'no local usage data for this provider yet; import, a native reader, and manual entry are not built yet' });
    if (usage.zeroPricedModels.length) blocks.push({ kind: 'note', text: `priced at $0 with tokens present: ${usage.zeroPricedModels.join(', ')}; add to modelPricing in plans.json` });
    if (opts.timing) blocks.push({ kind: 'note', text: `${data.elapsedMs} ms` });
    return { provider: adapter.id, displayName: adapter.displayName, data, blocks };
    }),
  );
  for (const section of sections) report.providers[section.provider] = section;
  if (opts.timing) report.caveats.push(`total ${Date.now() - started} ms`);

  ctx.write(renderReport(report, ctx.format === 'json' ? 'json' : 'terminal'));
  return 0;
}
