import pc from 'picocolors';
import * as p from '@clack/prompts';
import { ensureRoot } from '../config/paths';
import { ensurePlans, loadPlans, type PlansFile } from '../config/plans';
import { loadSettings, updateSettings } from '../config/settings';
import { defaultDoctorEnv, resolveAdapters } from '../providers/registry';
import type { DoctorEnv, ProviderAdapter } from '../providers/types';
import { addBaseline, currentByProvider, DuplicateBaselineError, listBaseline, type BaselineInput, type BaselineRecord } from '../store/baseline';
import { CliError, type CommandContext } from './context';

export interface SetupOptions {
  /** Force prompting where the TTY check would refuse. For tests and for a deliberate override. */
  interactive?: boolean;
}

/** One provider as setup found it, before anything is asked. */
export interface Found {
  id: string;
  displayName: string;
  /** Earliest date with usage data on disk, or null when there is none. */
  dataSince: string | null;
  /** The subscription already on record, if any. */
  held: BaselineRecord | null;
  plans: { id: string; name: string; monthlyUsd: number | null }[];
}

/** What the answers came to. Pure, so the shape of a run can be tested without a terminal. */
export interface SetupPlan {
  baselines: BaselineInput[];
  show: 'auto' | string[];
}

export interface Choice {
  provider: string;
  tier: string;
  product: string;
  price: number;
  billing: 'monthly' | 'annual';
}

/**
 * What is on this machine. Reads only; the answer is the same data `assess` uses to decide
 * visibility, so what setup shows and what the reports cover cannot drift apart.
 */
export async function survey(adapters: readonly ProviderAdapter[], plans: PlansFile, records: readonly BaselineRecord[], env: DoctorEnv): Promise<Found[]> {
  const held = currentByProvider([...records]);
  return Promise.all(
    adapters.map(async (a) => ({
      id: a.id,
      displayName: a.displayName,
      dataSince: a.localDataStart ? await a.localDataStart(env).catch(() => null) : null,
      held: held.get(a.id) ?? null,
      plans: (plans.providers[a.id]?.plans ?? []).map((pl) => ({ id: pl.id, name: pl.name, monthlyUsd: pl.monthlyUsd ?? null })),
    })),
  );
}

/**
 * Turn answers into records to append and a visibility list.
 *
 * Choosing nothing leaves visibility on 'auto' rather than writing an empty list. Someone who
 * pays for nothing yet should still see the provider they are plainly using, and a list of
 * none would blank every report until they came back and fixed it.
 */
export function setupPlan(choices: readonly Choice[], asOf: string): SetupPlan {
  const baselines = choices.map((c) => ({
    asOf,
    provider: c.provider,
    product: c.product,
    tier: c.tier,
    price: c.price,
    currency: 'USD',
    billing: c.billing,
  }));
  return { baselines, show: choices.length ? [...new Set(choices.map((c) => c.provider))].sort() : 'auto' };
}

/** One line per provider for the summary, so the reader sees what was detected before choosing. */
export function describeFound(f: Found): string {
  const bits: string[] = [];
  if (f.dataSince) bits.push(`usage data since ${f.dataSince}`);
  if (f.held) bits.push(`recorded: ${f.held.tier ?? f.held.product} at ${f.held.currency} ${f.held.price}/${f.held.billing}`);
  if (!bits.length) bits.push('nothing found on this machine');
  return `${f.dataSince || f.held ? pc.green('found') : pc.dim('   -')}  ${f.displayName.padEnd(14)} ${pc.dim(bits.join('; '))}`;
}

async function ask(found: Found[]): Promise<Choice[]> {
  p.intro('decadra setup');
  for (const f of found) p.log.message(describeFound(f));

  const picked = await p.multiselect({
    message: 'Which of these do you pay for?',
    options: found.map((f) => (f.dataSince ? { value: f.id, label: f.displayName, hint: 'in use here' } : { value: f.id, label: f.displayName })),
    initialValues: found.filter((f) => f.held || f.dataSince).map((f) => f.id),
    required: false,
  });
  if (p.isCancel(picked)) throw new CliError('cancelled', 130);

  const choices: Choice[] = [];
  for (const id of picked as string[]) {
    const f = found.find((x) => x.id === id) as Found;
    if (!f.plans.length) {
      p.log.warn(`${f.displayName} has no plans in plans.json; record it with: decadra baseline add --provider ${id}`);
      continue;
    }
    const options = f.plans.map((pl) => ({ value: pl.id, label: pl.monthlyUsd === null ? pl.name : `${pl.name} ($${pl.monthlyUsd}/mo)` }));
    const message = `${f.displayName}: which plan?`;
    const tier = await (f.held?.tier ? p.select({ message, options, initialValue: f.held.tier }) : p.select({ message, options }));
    if (p.isCancel(tier)) throw new CliError('cancelled', 130);
    const plan = f.plans.find((pl) => pl.id === tier) as { id: string; name: string; monthlyUsd: number | null };
    let price = plan.monthlyUsd;
    if (price === null) {
      const typed = await p.text({ message: `${f.displayName} ${plan.name}: price per month (USD)`, validate: (v) => (v?.trim() && Number.isFinite(Number(v)) && Number(v) >= 0 ? undefined : 'a number, 0 or more, is required') });
      if (p.isCancel(typed)) throw new CliError('cancelled', 130);
      price = Number(typed);
    }
    choices.push({ provider: id, tier: plan.id, product: plan.name, price, billing: 'monthly' });
  }
  return choices;
}

/**
 * Ask what this machine has and what you pay for, then record it.
 *
 * Re-running is how you change things: an identical answer is left alone, and a different plan
 * appends a new snapshot with today's date, which is what the baseline store already means by
 * a plan change. Nothing here writes plans.json.
 */
export async function runSetup(ctx: CommandContext, opts: SetupOptions = {}, deps?: { env?: DoctorEnv; now?: () => Date }): Promise<number> {
  // Prompts write decoration to stdout, which would sit in the middle of --json output.
  const canPrompt = ctx.format !== 'json' && (opts.interactive === true || process.stdin.isTTY === true);
  if (!canPrompt) {
    throw new CliError('setup is interactive; run it on a terminal, or use: decadra baseline add --provider ... --tier ... --price ...');
  }
  await ensureRoot(ctx.paths);
  await ensurePlans(ctx.paths);
  const plans = await loadPlans(ctx.paths);
  const env = deps?.env ?? defaultDoctorEnv();
  const now = deps?.now ?? ((): Date => new Date());
  const { records } = await listBaseline(ctx.paths.baseline);
  const found = await survey(resolveAdapters(plans), plans, records, env);

  const choices = await ask(found);
  const planned = setupPlan(choices, now().toISOString().slice(0, 10));

  let added = 0;
  for (const input of planned.baselines) {
    try {
      await addBaseline(ctx.paths.baseline, input);
      added += 1;
    } catch (e) {
      // An unchanged answer is not a correction, and the store is right to refuse it.
      if (!(e instanceof DuplicateBaselineError)) throw e;
    }
  }
  await updateSettings(ctx.paths, { providers: { show: planned.show }, setupOfferedAt: now().toISOString() });

  const covered = planned.show === 'auto' ? 'whatever you use or pay for' : planned.show.join(', ');
  p.outro(added ? `recorded ${added} subscription(s). assess, sessions and now will cover: ${covered}` : `nothing new to record. assess, sessions and now will cover: ${covered}`);
  return 0;
}

/**
 * Offered once, on a bare interactive run with nothing recorded yet.
 *
 * Declining is remembered, so a new user is asked once and someone who does not want it is
 * never asked again. Nothing here reaches an agent's `!` shell or a piped run: the caller has
 * already returned in both cases.
 */
export async function offerSetupOnFirstRun(ctx: CommandContext, deps?: { env?: DoctorEnv; now?: () => Date }): Promise<void> {
  // The caller has already gated on a terminal, but a question that escapes into a pipe is
  // bad enough to be worth refusing twice.
  if (ctx.format === 'json' || process.stdin.isTTY !== true) return;
  await ensureRoot(ctx.paths);
  const now = deps?.now ?? ((): Date => new Date());
  const settings = await loadSettings(ctx.paths).catch(() => null);
  if (!settings || settings.setupOfferedAt) return;
  const { records } = await listBaseline(ctx.paths.baseline);
  if (records.length) return;

  const yes = await p.confirm({ message: 'Nothing recorded yet. Set up decadra now? It asks what you pay for.' });
  if (p.isCancel(yes) || !yes) {
    await updateSettings(ctx.paths, { setupOfferedAt: now().toISOString() });
    ctx.write(pc.dim('skipped. Run it later with: decadra setup'));
    return;
  }
  await runSetup(ctx, {}, deps);
}
