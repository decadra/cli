/**
 * The report contract. A Report holds one section per provider and nothing
 * that spans providers. Renderers receive one section at a time. See AGENTS.md.
 */
export type ProviderId = string;

export type Block =
  | { kind: 'line'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'kv'; rows: Array<[string, string]> }
  | { kind: 'table'; columns: string[]; rows: string[][] };

export interface ProviderSection<T = unknown> {
  provider: ProviderId;
  displayName: string;
  /** Machine payload for --json. Command-specific, validated by that command's schema. */
  data: T;
  /** Human payload for terminal and html. */
  blocks: Block[];
}

export interface ReportWindow {
  since: string;
  until: string;
  months?: number;
}

export const REPORT_SCHEMA_VERSION = 1;

export interface Report<T = unknown> {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generatedAt: string;
  timezone: 'UTC';
  window: ReportWindow;
  caveats: string[];
  bill: Bill | null;
  providers: Record<ProviderId, ProviderSection<T>>;
}

export const CAVEATS = {
  commitProxy:
    'Commit correlation is a weak proxy. It detects that a commit landed near the session in that directory, not that the session produced it. Sessions in the same repo back to back, and two tools open on the same repo at once, attribute the same commit to both.',
  listPrice:
    'List-price equivalent is what the observed tokens would cost at pay-as-you-go list prices. It measures consumption, not value, and is not what a subscription charges.',
  ceilingEstimate:
    'Plan ceilings are unpublished. Any figure marked est. is your own anchor times the vendor stated multiplier. "Above your estimate" is not a recorded limit hit.',
  perProvider:
    'Each provider is reported on its own. Token counts and units differ across vendors and are never added together or set against each other.',
  readout:
    'Readout only: consumption at list prices, not value. Per provider, never across providers. Not an instruction to change anything.',
  bill:
    'The bill line is the sum of subscription prices you recorded in the baseline. It is money paid, not usage, and the only figure that spans providers.',
} as const;

export interface PlanFitVerdict {
  provider: ProviderId;
  heldPlan: string | null;
  heldPlanName?: string | null;
  bestFitPlan: string | null;
  bestFitPlanName?: string | null;
  direction: 'upgrade' | 'downgrade' | 'hold' | 'unknown';
  monthsOfEvidence: number;
  evidence: string[];
  confidence: 'low' | 'medium' | 'high';
}

/** Sum of subscription prices from the baseline. Prices only, never usage. */
export interface Bill {
  monthlyUsd: number;
  count: number;
  asOf: string;
}


/** The only accepted top-level keys of a rendered JSON report. Snapshot-tested. `bill` is the price-sum carve-out. */
export const REPORT_TOP_LEVEL_KEYS = ['schemaVersion', 'generatedAt', 'timezone', 'window', 'caveats', 'bill', 'providers'] as const;

export function emptyReport(window: ReportWindow, caveats: string[] = [CAVEATS.perProvider]): Report {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    timezone: 'UTC',
    window,
    caveats,
    bill: null,
    providers: {},
  };
}
