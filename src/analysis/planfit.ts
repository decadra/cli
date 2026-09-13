import type { Plan, MeterUnit } from '../config/plans';
import type { PlanFitVerdict } from '../report/model';
import { formatAmount, meterNoun } from './units';

/**
 * Plan-fit math for one provider. Pure. Takes normalized monthly usage in the
 * provider's own unit and returns effective cost under every plan the vendor
 * sells, plus a structured verdict. It never sees another provider.
 */
export interface MonthlyUsage {
  month: string;
  /** Usage in the provider's meter unit: usd-list, usd-billed, or acu. */
  amount: number;
  daysObserved: number;
  daysInMonth: number;
  tokens?: { input: number; output: number; cacheWrite: number; cacheRead: number };
}

export interface WindowPeak {
  kind: 'short' | 'weekly';
  /** Peak usage in the meter unit over the window. */
  max: number;
  p95: number;
  /** Display only; never used for a judgement. */
  p50?: number;
}

export interface HeldMonth {
  month: string;
  planId: string | null;
  days: number;
}

export interface PlanFitInput {
  provider: string;
  meter: MeterUnit;
  plans: Plan[];
  basePlan?: string | undefined;
  heldPlan: string | null;
  monthly: MonthlyUsage[];
  windowPeaks: WindowPeak[];
  anchors?: { short: number | null; weekly: number | null } | undefined;
  /**
   * Utilization percentages the tool itself recorded, where it writes them (Codex).
   * Each sample carries the plan it was recorded on, because a window observed on Plus
   * means something different from the same number observed on Pro.
   */
  recordedUtilization?: RecordedUtilization[] | undefined;
  /** Months with fewer observed days than this are excluded from evidence. Default 7. */
  minDaysForEvidence?: number | undefined;
  /** Which plan was held for how many days of each month. Evidence and paid figure only. */
  heldByMonth?: HeldMonth[] | undefined;
}

export interface RecordedUtilization {
  kind: 'short' | 'weekly';
  percent: number;
  /** The plan the tool named when it wrote the sample. Null when it did not say. */
  planType: string | null;
}

export interface PlanFitRow {
  planId: string;
  name: string;
  monthlyUsd: number;
  /** Median over months of what this plan would have cost. Null when it cannot be priced. */
  effectiveUsdPerMonth: number | null;
  /** usage / price, capped-window plans only. */
  multiple: number | null;
  /** Ceiling judgement: true fits, false exceeded, null no evidence. */
  fits: boolean | null;
  fitsBasis: 'anchor' | 'recorded' | 'none' | 'not-capped';
  notes: string[];
}

export function prorate(m: MonthlyUsage): number {
  if (m.daysObserved <= 0 || m.daysObserved >= m.daysInMonth) return m.amount;
  return (m.amount / m.daysObserved) * m.daysInMonth;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function tokenCost(m: MonthlyUsage, p: { input: number; output: number; cacheWrite?: number | undefined; cacheRead?: number | undefined }): number | null {
  if (!m.tokens) return null;
  const t = m.tokens;
  return (t.input * p.input + t.output * p.output + t.cacheWrite * (p.cacheWrite ?? p.input) + t.cacheRead * (p.cacheRead ?? p.input)) / 1e6;
}

function effectiveForMonth(plan: Plan, m: MonthlyUsage): number | null {
  const usage = prorate(m);
  const a = plan.allowance;
  switch (a.kind) {
    case 'capped-window':
      return plan.monthlyUsd;
    case 'included-credit':
      return plan.monthlyUsd + Math.max(0, usage - a.amount) * a.overageUsdPerUnit;
    case 'metered': {
      if (a.tokenPricing) {
        const c = tokenCost(m, a.tokenPricing);
        return c === null ? null : plan.monthlyUsd + Math.max(a.minimumUsd ?? 0, c);
      }
      return plan.monthlyUsd + Math.max(a.minimumUsd ?? 0, usage * (a.usdPerUnit ?? 0));
    }
  }
}

/** The plan a tool named in a sample, matched by id then by name, both case-insensitively. */
function planFor(plans: Plan[], planType: string | null): Plan | undefined {
  if (!planType) return undefined;
  const want = planType.trim().toLowerCase();
  return plans.find((p) => p.id.toLowerCase() === want) ?? plans.find((p) => p.name.toLowerCase() === want);
}

function multiplierOf(plan: Plan): number | null {
  return plan.allowance.kind === 'capped-window' ? plan.allowance.multiplierVsBase : null;
}

function ceilingJudgement(plan: Plan, input: PlanFitInput): { fits: boolean | null; basis: PlanFitRow['fitsBasis']; notes: string[] } {
  const mult = multiplierOf(plan);
  if (mult === null) return { fits: true, basis: 'not-capped', notes: [] };
  const notes: string[] = [];
  const held = input.plans.find((p) => p.id === input.heldPlan);
  const heldMult = held ? multiplierOf(held) : null;
  const samples = input.recordedUtilization ?? [];
  if (samples.length) {
    // Scale every sample by the plan it was recorded on, not by the plan held on the
    // last day of the window. A downgrade mid-window makes those two different plans.
    const scaledPeak = new Map<'short' | 'weekly', { scaled: number; percent: number; on: Plan | null }>();
    for (const s of samples) {
      const on = planFor(input.plans, s.planType) ?? held ?? null;
      const onMult = on ? multiplierOf(on) : heldMult;
      if (onMult === null) continue;
      const scaled = (s.percent * onMult) / mult;
      const seen = scaledPeak.get(s.kind);
      if (!seen || scaled > seen.scaled) scaledPeak.set(s.kind, { scaled, percent: s.percent, on });
    }
    if (scaledPeak.size) {
      let fits = true;
      for (const kind of ['short', 'weekly'] as const) {
        const peak = scaledPeak.get(kind);
        if (!peak) continue;
        notes.push(`recorded peak ${kind} utilization ${peak.percent.toFixed(0)}% on ${peak.on?.name ?? 'the plan held then'}, scaled to ${plan.name}: ${peak.scaled.toFixed(0)}%`);
        if (peak.scaled >= 100) fits = false;
      }
      return { fits, basis: 'recorded', notes };
    }
  }
  if (input.anchors) {
    let fits: boolean | null = null;
    for (const kind of ['short', 'weekly'] as const) {
      const anchor = input.anchors[kind];
      const peak = input.windowPeaks.find((w) => w.kind === kind);
      if (anchor === null || !peak) continue;
      const estimate = anchor * mult;
      const above = peak.max > estimate;
      notes.push(`peak ${kind} window ${peak.max.toFixed(2)} against your estimate ${estimate.toFixed(2)} for ${plan.name} (est.)${above ? ', above' : ''}`);
      fits = fits === false ? false : !above;
    }
    if (fits !== null) return { fits, basis: 'anchor', notes };
  }
  return { fits: null, basis: 'none', notes: ['no ceiling evidence: set anchorApiEquivalentUsd in plans.json, or rely on recorded utilization where the tool writes it'] };
}

export function assessPlanFit(input: PlanFitInput): { rows: PlanFitRow[]; verdict: PlanFitVerdict } {
  const minDays = input.minDaysForEvidence ?? 7;
  const months = input.monthly.filter((m) => m.daysObserved >= minDays);
  const usageMedian = median(months.map(prorate));
  const rows: PlanFitRow[] = input.plans.map((plan) => {
    const perMonth = months.map((m) => effectiveForMonth(plan, m)).filter((x): x is number => x !== null);
    // A token-priced plan cannot be costed without token counts. Leaving it at median([])
    // gave it an effective cost of $0, which won every comparison it entered.
    const effective = months.length && !perMonth.length ? null : median(perMonth);
    const mult = multiplierOf(plan);
    const judgement = ceilingJudgement(plan, input);
    const notes = [...judgement.notes];
    if (effective === null) notes.push('cannot be priced from this data: the plan charges per token and no token counts were ingested');
    return {
      planId: plan.id,
      name: plan.name,
      monthlyUsd: plan.monthlyUsd,
      effectiveUsdPerMonth: effective,
      multiple: mult !== null && plan.monthlyUsd > 0 ? usageMedian / plan.monthlyUsd : null,
      fits: judgement.fits,
      fitsBasis: judgement.basis,
      notes,
    };
  });

  const candidates = rows.filter(
    (r): r is PlanFitRow & { effectiveUsdPerMonth: number } =>
      r.effectiveUsdPerMonth !== null && r.fits !== false && (r.fits !== null || r.fitsBasis !== 'none'),
  );
  const best = candidates.length
    ? [...candidates].sort((a, b) => a.effectiveUsdPerMonth - b.effectiveUsdPerMonth || a.monthlyUsd - b.monthlyUsd)[0] ?? null
    : null;

  const heldRow = rows.find((r) => r.planId === input.heldPlan) ?? null;
  const fullMonths = months.filter((m) => m.daysObserved >= m.daysInMonth).length;
  const confidence: PlanFitVerdict['confidence'] = fullMonths >= 3 ? 'high' : fullMonths >= 2 ? 'medium' : 'low';

  const evidence: string[] = [];
  const fmt = (n: number): string => formatAmount(input.meter, n);
  evidence.push(`Median ${meterNoun(input.meter)} ${fmt(usageMedian)} per month over ${months.length} month(s).`);
  if (heldRow) {
    const cost = heldRow.effectiveUsdPerMonth === null ? 'an amount this data cannot price' : `${fmt(heldRow.effectiveUsdPerMonth)} per month`;
    evidence.push(`Held plan ${heldRow.name} costs ${cost} for that usage${heldRow.multiple !== null ? ` (${heldRow.multiple.toFixed(1)}x its price)` : ''}.`);
  }
  if (best) evidence.push(`Lowest effective cost with no ceiling exceeded: ${best.name} at ${fmt(best.effectiveUsdPerMonth)} per month.`);
  if (input.heldByMonth?.length) {
    const paid = input.heldByMonth.reduce((acc, h) => {
      const plan = input.plans.find((p) => p.id === h.planId);
      const dim = new Date(Date.UTC(Number(h.month.slice(0, 4)), Number(h.month.slice(5, 7)), 0)).getUTCDate();
      return acc + (plan ? (plan.monthlyUsd * h.days) / dim : 0);
    }, 0);
    const distinct = [...new Set(input.heldByMonth.map((h) => h.planId).filter(Boolean))];
    if (distinct.length > 1) evidence.push(`Plans held across the window: ${distinct.map((id) => input.plans.find((p) => p.id === id)?.name ?? id).join(', then ')}.`);
    if (paid > 0) evidence.push(`Paid for held plans across the window: $${paid.toFixed(2)}.`);
  }
  for (const r of rows) for (const n of r.notes) if (r.fitsBasis !== 'none') evidence.push(`${r.name}: ${n}.`);
  if (rows.every((r) => r.fitsBasis === 'none')) evidence.push(rows[0]?.notes[0] ?? '');

  let direction: PlanFitVerdict['direction'] = 'unknown';
  if (best && heldRow) {
    if (best.planId === heldRow.planId) direction = 'hold';
    else direction = best.monthlyUsd > heldRow.monthlyUsd ? 'upgrade' : 'downgrade';
  }

  return {
    rows,
    verdict: {
      provider: input.provider,
      heldPlan: input.heldPlan,
      heldPlanName: heldRow?.name ?? null,
      bestFitPlan: best?.planId ?? null,
      bestFitPlanName: best?.name ?? null,
      direction,
      monthsOfEvidence: months.length,
      evidence: evidence.filter(Boolean),
      confidence,
    },
  };
}
