import type { PlanFitVerdict, ProviderSection } from './model';

/**
 * Fixed templates. Each takes one provider's data and can only mention that
 * provider. There is no template that takes two sections.
 */
export function planFitLine(section: ProviderSection<{ verdict: PlanFitVerdict }>): string {
  const v = section.data.verdict;
  const best = v.bestFitPlanName ?? v.bestFitPlan;
  const held = v.heldPlanName ?? v.heldPlan;
  const name = section.displayName;
  if (v.monthsOfEvidence === 0) {
    return `${name}: no usage evidence in this window.`;
  }
  if (v.heldPlan === null) {
    const tail = best ? ` Lowest effective cost for this usage: ${best}.` : '';
    return `${name}: no baseline snapshot for this provider; record one with decadra baseline add.${tail}`;
  }
  if (!best) {
    return `${name}: no ceiling evidence yet, so no plan can be called a fit. Held: ${held}. ${v.evidence.join(' ')}`;
  }
  if (v.direction === 'hold') {
    return `${name}: on observed usage, ${held} fits (${v.confidence} confidence, ${v.monthsOfEvidence} months). ${v.evidence.join(' ')}`;
  }
  return `${name}: on observed usage, ${best} fits; held plan is ${held} (${v.direction}, ${v.confidence} confidence, ${v.monthsOfEvidence} months). ${v.evidence.join(' ')}`;
}
