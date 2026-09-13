import pc from 'picocolors';
import { columns } from '../report/layout';
import * as p from '@clack/prompts';
import { ensureRoot } from '../config/paths';
import { ensurePlans, loadPlans, type PlansFile } from '../config/plans';
import { builtinAdapters } from '../providers/registry';
import { addBaseline, currentByProvider, DuplicateBaselineError, listBaseline, type BaselineInput } from '../store/baseline';
import { CliError, type CommandContext } from './context';

export interface BaselineAddOptions {
  provider?: string;
  product?: string;
  tier?: string;
  price?: number;
  currency?: string;
  billing?: 'monthly' | 'annual';
  asOf?: string;
  note?: string;
  supersedes?: string;
  force?: boolean;
  interactive?: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function knownTiers(plans: PlansFile, provider: string): string[] {
  return plans.providers[provider]?.plans.map((pl) => pl.id) ?? [];
}

async function promptMissing(opts: BaselineAddOptions, plans: PlansFile): Promise<BaselineInput> {
  p.intro('decadra baseline add');
  const providerIds = Object.keys(plans.providers).sort();
  const provider =
    opts.provider ??
    (await p.select({
      message: 'Provider',
      options: [...providerIds.map((id) => ({ value: id, label: `${plans.providers[id]?.displayName ?? id} (${id})` })), { value: '__other', label: 'Other (type a name)' }],
    }));
  if (p.isCancel(provider)) throw new CliError('cancelled', 130);
  const providerId = provider === '__other' ? await p.text({ message: 'Provider name', validate: (v) => (v?.trim() ? undefined : 'required') }) : provider;
  if (p.isCancel(providerId)) throw new CliError('cancelled', 130);
  const tiers = knownTiers(plans, String(providerId));
  let tier: string | null = opts.tier ?? null;
  let product = opts.product;
  // --help promises a prompt for every field, so -i asks even when tier is the only gap.
  if (!tier && tiers.length) {
    const t = await p.select({ message: 'Plan', options: tiers.map((id) => ({ value: id, label: plans.providers[String(providerId)]?.plans.find((x) => x.id === id)?.name ?? id })) });
    if (p.isCancel(t)) throw new CliError('cancelled', 130);
    tier = t;
    product ??= plans.providers[String(providerId)]?.plans.find((x) => x.id === t)?.name;
  }
  if (!product) {
    const v = await p.text({ message: 'Product name', placeholder: 'e.g. Cursor Pro', validate: (s) => (s?.trim() ? undefined : 'required') });
    if (p.isCancel(v)) throw new CliError('cancelled', 130);
    product = v;
  }
  let price = opts.price;
  if (price === undefined) {
    const known = tier ? plans.providers[String(providerId)]?.plans.find((x) => x.id === tier)?.monthlyUsd : undefined;
    const v = await p.text({ message: 'Price per period (USD)', initialValue: known !== undefined ? String(known) : '', validate: (s) => (s?.trim() && Number.isFinite(Number(s)) && Number(s) >= 0 ? undefined : 'a number, 0 or more, is required') });
    if (p.isCancel(v)) throw new CliError('cancelled', 130);
    price = Number(v);
  }
  let billing = opts.billing;
  if (!billing) {
    const v = await p.select({ message: 'Billing period', options: [{ value: 'monthly', label: 'monthly' }, { value: 'annual', label: 'annual' }] });
    if (p.isCancel(v)) throw new CliError('cancelled', 130);
    billing = v as 'monthly' | 'annual';
  }
  p.outro('recorded');
  const input: BaselineInput = {
    asOf: opts.asOf ?? today(),
    provider: String(providerId),
    product,
    tier,
    price,
    currency: (opts.currency ?? 'USD').toUpperCase(),
    billing,
  };
  if (opts.note) input.note = opts.note;
  if (opts.supersedes) input.supersedes = opts.supersedes;
  return input;
}

export async function runBaselineAdd(ctx: CommandContext, opts: BaselineAddOptions): Promise<void> {
  await ensureRoot(ctx.paths);
  await ensurePlans(ctx.paths);
  const plans = await loadPlans(ctx.paths);
  const missing = ['provider', 'product', 'price'].filter((k) => (opts as Record<string, unknown>)[k] === undefined);
  // A registered provider also needs a tier, and -i promises to ask for whatever is absent.
  const tierMissing = opts.tier === undefined && (opts.provider === undefined || knownTiers(plans, opts.provider).length > 0);
  const wantsPrompt = opts.interactive === true || missing.length > 0 || tierMissing;
  let input: BaselineInput;
  // Prompts write decoration to stdout, which would sit in the middle of --json output.
  const canPrompt = ctx.format !== 'json' && (opts.interactive === true || process.stdin.isTTY === true);
  if (wantsPrompt && canPrompt) {
    input = await promptMissing(opts, plans);
  } else if (missing.length) {
    const how = ctx.format === 'json' ? 'pass every flag with --json' : 'or run on a terminal for prompts';
    throw new CliError(`missing --${missing.join(', --')} (${how})`);
  } else {
    input = {
      asOf: opts.asOf ?? today(),
      provider: opts.provider as string,
      product: opts.product as string,
      tier: opts.tier ?? null,
      price: opts.price as number,
      currency: (opts.currency ?? 'USD').toUpperCase(),
      billing: opts.billing ?? 'monthly',
    };
    if (opts.note) input.note = opts.note;
    if (opts.supersedes) input.supersedes = opts.supersedes;
  }
  if (!Number.isFinite(input.price) || input.price < 0) throw new CliError('--price must be a number, 0 or more');
  if (input.supersedes) {
    // A correction has to correct something, and something of this provider: superseding
    // another provider's snapshot would silently retire the wrong subscription.
    const { records } = await listBaseline(ctx.paths.baseline);
    const target = records.find((r) => r.id === input.supersedes);
    if (!target) throw new CliError(`--supersedes ${input.supersedes} names no snapshot; see decadra baseline list`);
    if (target.provider !== input.provider) {
      throw new CliError(`--supersedes ${input.supersedes} is a ${target.provider} snapshot, but this one is for ${input.provider}`);
    }
  }
  const registered = builtinAdapters.some((a) => a.id === input.provider) || input.provider in plans.providers;
  if (registered) {
    const tiers = knownTiers(plans, input.provider);
    if (!input.tier || !tiers.includes(input.tier)) {
      throw new CliError(`--tier must be one of ${tiers.join(', ')} for ${input.provider}, so assess can attribute usage to it`);
    }
  }
  try {
    const record = await addBaseline(ctx.paths.baseline, input, { force: opts.force ?? false });
    if (ctx.format === 'json') {
      ctx.write(JSON.stringify(record, null, 2));
    } else {
      ctx.write(`${pc.green('recorded')} ${record.provider} ${record.tier ?? record.product} ${record.currency} ${record.price}/${record.billing} as of ${record.asOf} (id ${record.id})`);
    }
  } catch (e) {
    if (e instanceof DuplicateBaselineError) throw new CliError(e.message, 1);
    throw e;
  }
}

export async function runBaselineList(ctx: CommandContext): Promise<void> {
  const { records, malformed } = await listBaseline(ctx.paths.baseline);
  const current = currentByProvider(records);
  if (ctx.format === 'json') {
    ctx.write(JSON.stringify({ file: ctx.paths.baseline, malformed, current: Object.fromEntries(current), snapshots: records }, null, 2));
    return;
  }
  if (!records.length) {
    ctx.write(`no snapshots yet in ${ctx.paths.baseline}. Record one with: decadra baseline add`);
    return;
  }
  ctx.write(
    columns(
      ['as of', 'provider', 'tier / product', 'price', 'billing', 'id', 'note'],
      records.map((r) => {
        const cur = current.get(r.provider)?.id === r.id ? pc.green('current ') : '';
        return [r.asOf, r.provider, r.tier ?? r.product, `${r.currency} ${r.price}`, r.billing, r.id, cur + (r.note ?? '') + (r.supersedes ? pc.dim(` supersedes ${r.supersedes}`) : '')];
      }),
      { right: [3] },
    ),
  );
  if (malformed) ctx.write(pc.yellow(`${malformed} malformed line(s) skipped in ${ctx.paths.baseline}`));
}
