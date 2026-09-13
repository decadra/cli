import type { PlanFitVerdict } from '../report/model';

/**
 * Plan-change alert rules. Pure over a provider's verdict history. An alert
 * says one provider's own plans point the same way for N consecutive months;
 * it never mentions another provider.
 */
export interface VerdictHistoryEntry extends PlanFitVerdict {
  recordedAt: string;
  window: { since: string; until: string; months?: number };
}

export interface AlertRuleSettings {
  consecutiveMonths: number;
  minDays: number;
}

export interface AlertCandidate {
  provider: string;
  direction: 'upgrade' | 'downgrade';
  bestFitPlan: string;
  bestFitPlanName: string | null;
  heldPlan: string | null;
  heldPlanName: string | null;
  monthsAgreeing: number;
  basedOn: string[];
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
}

/** Latest standard-window verdict per calendar month of recording, oldest first. */
export function monthlyVerdicts(history: VerdictHistoryEntry[]): VerdictHistoryEntry[] {
  const byMonth = new Map<string, VerdictHistoryEntry>();
  for (const v of history) {
    if (v.window.months === undefined) continue;
    const key = v.recordedAt.slice(0, 7);
    const prev = byMonth.get(key);
    if (!prev || prev.recordedAt < v.recordedAt) byMonth.set(key, v);
  }
  return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
}

/** The month before `month`, as YYYY-MM. */
function previousMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** True when the months are consecutive calendar months, oldest first. */
export function calendarAdjacent(months: string[]): boolean {
  for (let i = 1; i < months.length; i += 1) {
    if (previousMonth(months[i] as string) !== months[i - 1]) return false;
  }
  return true;
}

export function evaluate(
  history: VerdictHistoryEntry[],
  settings: AlertRuleSettings,
  lastBaselineChange: string | null,
  lastAlertFor: (direction: string, bestFitPlan: string) => string | null,
  currentHeldPlan: string | null,
): AlertCandidate | null {
  const monthly = monthlyVerdicts(history);
  if (monthly.length < settings.consecutiveMonths) return null;
  const recent = monthly.slice(-settings.consecutiveMonths);
  const head = recent[recent.length - 1] as VerdictHistoryEntry;
  if (head.direction !== 'upgrade' && head.direction !== 'downgrade') return null;
  if (!head.bestFitPlan) return null;
  if (!recent.every((v) => v.direction === head.direction && v.bestFitPlan === head.bestFitPlan && v.monthsOfEvidence >= 1)) return null;
  // "N consecutive months" has to mean consecutive. Two runs either side of a gap are not
  // a trend, and taking the last N recorded months silently treated them as one.
  if (!calendarAdjacent(recent.map((v) => v.recordedAt.slice(0, 7)))) return null;
  if (daysBetween(head.window.since, head.window.until) < settings.minDays) return null;
  // The verdicts describe a plan that may no longer be held. Once you are already on the
  // plan they point at, there is nothing to say.
  if (currentHeldPlan !== null && currentHeldPlan === head.bestFitPlan) return null;
  // Cooldown: never twice for the same direction and plan unless the baseline changed and
  // a verdict was recorded after that change. Any later baseline row used to lift it, so
  // an unrelated correction re-fired an alert on evidence that predated it.
  const last = lastAlertFor(head.direction, head.bestFitPlan);
  if (last) {
    if (!lastBaselineChange || lastBaselineChange <= last) return null;
    if (head.recordedAt <= lastBaselineChange) return null;
  }
  return {
    provider: head.provider,
    direction: head.direction,
    bestFitPlan: head.bestFitPlan,
    bestFitPlanName: head.bestFitPlanName ?? null,
    heldPlan: head.heldPlan,
    heldPlanName: head.heldPlanName ?? null,
    monthsAgreeing: recent.length,
    basedOn: recent.map((v) => v.recordedAt),
  };
}
