import type { ProviderPlans } from '../config/plans';
import type { ProviderAdapter, DoctorEnv } from '../providers/types';
import type { DateRange } from '../analysis/months';
import { addDays, toCcusageDate } from '../analysis/months';
import type { BlockLite } from '../analysis/windows';
import { fetchBlocks, fetchDaily, fetchSessions, type CcusageRunner } from './ccusage';
import { zeroPricedModels, type NormalizedDaily, type NormalizedSession } from './ccusage.schema';

export interface UsageDeps {
  runCcusage: CcusageRunner;
  now: () => Date;
  configPath: string | null;
}

export interface ProviderUsage {
  source: 'ccusage' | 'none';
  daily: NormalizedDaily[];
  blocks: BlockLite[];
  sessions: NormalizedSession[];
  zeroPricedModels: string[];
  dataStart: string | null;
  error: string | null;
}

export interface LoadOptions {
  blocks: boolean;
  sessions: boolean;
  shortWindowHours: number | null;
}

function shortWindowHours(plans: ProviderPlans | undefined, range: DateRange): number | null {
  const w = plans?.windows.find((x) => x.kind === 'short' && x.effectiveFrom <= range.until && (!x.effectiveTo || x.effectiveTo >= range.since));
  return w ? w.hours : null;
}

/**
 * `wantBlocks` is the caller saying it reads the short-window peak. Only assess does, and
 * fetching blocks for now meant a second ccusage process on the path that has to be fast.
 */
export function loadOptionsFor(adapter: ProviderAdapter, plans: ProviderPlans | undefined, range: DateRange, wantSessions: boolean, wantBlocks: boolean): LoadOptions {
  const hours = shortWindowHours(plans, range);
  const blocks = wantBlocks && adapter.usage.kind === 'ccusage' && adapter.usage.source === 'claude' && hours !== null;
  return { blocks, sessions: wantSessions, shortWindowHours: hours };
}

const empty = (): ProviderUsage => ({ source: 'none', daily: [], blocks: [], sessions: [], zeroPricedModels: [], dataStart: null, error: null });

/**
 * The one place both `now` and `assess` get usage from. ccusage-backed adapters
 * are queried; everything else reports source 'none' so the absence is visible.
 * A failure is returned, not thrown, so one provider cannot hide the others.
 */
export async function loadProviderUsage(adapter: ProviderAdapter, range: DateRange, opts: LoadOptions, deps: UsageDeps, env: DoctorEnv): Promise<ProviderUsage> {
  if (adapter.usage.kind !== 'ccusage') return empty();
  const out: ProviderUsage = { ...empty(), source: 'ccusage' };
  const base = { source: adapter.usage.source, since: toCcusageDate(range.since), until: toCcusageDate(range.until), configPath: deps.configPath ?? undefined };
  try {
    // Three separate ccusage processes that do not depend on each other. Run them at once.
    // ccusage's session report treats --until as exclusive while daily treats it as
    // inclusive (verified on 20.0.20), so the session fetch asks for the day after.
    const [daily, blocks, sessions, dataStart] = await Promise.all([
      fetchDaily(deps.runCcusage, base),
      opts.blocks ? fetchBlocks(deps.runCcusage, { ...base, sessionLengthHours: opts.shortWindowHours ?? undefined }) : Promise.resolve([]),
      opts.sessions ? fetchSessions(deps.runCcusage, { ...base, until: toCcusageDate(addDays(range.until, 1)) }) : Promise.resolve([]),
      adapter.localDataStart ? adapter.localDataStart(env) : Promise.resolve(null),
    ]);
    out.daily = daily;
    out.blocks = blocks;
    out.sessions = sessions;
    out.dataStart = dataStart;
    out.zeroPricedModels = zeroPricedModels([...out.daily, ...out.sessions]);
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}
