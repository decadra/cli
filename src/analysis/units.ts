import type { MeterUnit } from '../config/plans';

/**
 * The one place a number becomes text in a provider's own meter unit. Units are never
 * converted between providers, so the unit has to travel with the number rather than
 * being assumed to be dollars at the point of printing.
 */
export function formatAmount(meter: MeterUnit, n: number): string {
  return meter === 'acu' ? `${n.toFixed(1)} ACU` : `$${n.toFixed(2)}`;
}

/** What the figure is, for a line that has already printed the number. */
export function meterLabel(meter: MeterUnit): string {
  return meter === 'usd-list' ? 'list-equivalent' : meter === 'usd-billed' ? 'billed' : 'ACU';
}

/** How the figure is described in a sentence. */
export function meterNoun(meter: MeterUnit): string {
  return meter === 'usd-list' ? 'list-price equivalent' : meter === 'usd-billed' ? 'billed usage' : 'usage';
}

/**
 * Minutes as a duration a person can picture. A session that ran 33708 minutes is 23 days, and
 * nobody reads that out of five digits. Two units at most: the third is noise at every scale
 * this prints, and the value is a median or a p90, not a stopwatch reading.
 */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '0m';
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
