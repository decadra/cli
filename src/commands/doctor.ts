import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import pc from 'picocolors';
import { execa } from 'execa';
import { ensureRoot } from '../config/paths';
import { CACHE_WRITE_TTL_RATIOS, ensurePlans, loadPlans, PlansError, priceRatioIssues, type PlansFile } from '../config/plans';
import { loadSettings } from '../config/settings';
import { ccusageVersion, commandLine } from '../ingest/ccusage';
import { buildPricingOverrides, writeCcusageConfig } from '../ingest/ccusage-config';
import { loadOptionsFor, loadProviderUsage } from '../ingest/usage';
import { monthsBack, todayUtc } from '../analysis/months';
import { defaultDeps, type CommandDeps } from './deps';
import { defaultDoctorEnv, hiddenReason, resolveAdapters, visibleProviders } from '../providers/registry';
import { check, type DoctorCheck } from '../providers/types';
import { clip, glyph, width, wrap } from '../report/layout';
import type { SessionRecord } from '../ingest/types';
import { listBaseline } from '../store/baseline';
import { type CommandContext } from './context';

/**
 * A price is entered once and charged to every cache write, whatever TTL the write asked for.
 * The transcripts say which TTL the work actually used, so the two together say whether the rate
 * fits. Stays inside one provider's own sessions and prices: nothing is summed across providers.
 */
function cacheWriteTtlCheck(provider: string, records: SessionRecord[], plans: PlansFile): DoctorCheck | null {
  const stated = records.filter((r) => r.cacheWrite1hTokens !== null || r.cacheWrite5mTokens !== null);
  const oneHour = stated.reduce((t, r) => t + (r.cacheWrite1hTokens ?? 0), 0);
  const fiveMinutes = stated.reduce((t, r) => t + (r.cacheWrite5mTokens ?? 0), 0);
  const total = oneHour + fiveMinutes;
  if (!total) return null;

  const share = oneHour / total;
  const dominant = share >= 0.5 ? 'oneHour' : 'fiveMinutes';
  const pct = `${Math.round(share * 100)}% of cache writes in the last 7 days asked for a 1-hour TTL`;
  const models = [...new Set(stated.flatMap((r) => r.models))].sort();
  const wrong = models.filter((m) => {
    const p = plans.modelPricing[m];
    if (!p || typeof p.input !== 'number' || p.input <= 0 || typeof p.cacheWrite !== 'number') return false;
    const ratio = p.cacheWrite / p.input;
    const near = (target: number): boolean => Math.abs(ratio - target) / target < 0.1;
    return dominant === 'oneHour' ? near(CACHE_WRITE_TTL_RATIOS.fiveMinutes) : near(CACHE_WRITE_TTL_RATIOS.oneHour);
  });
  if (!wrong.length) return check(provider, `${provider}.cacheWriteTtl`, 'ok', `${pct}; no model price contradicts that`);
  const rate = dominant === 'oneHour' ? '5-minute' : '1-hour';
  const want = dominant === 'oneHour' ? CACHE_WRITE_TTL_RATIOS.oneHour : CACHE_WRITE_TTL_RATIOS.fiveMinutes;
  return check(
    provider,
    `${provider}.cacheWriteTtl`,
    'warn',
    `${pct}, but cacheWrite is set at the ${rate} rate for ${wrong.join(', ')}`,
    `one cache-creation rate is charged to every write whatever its TTL, so set cacheWrite to about ${want}x the input price for this work`,
  );
}

export async function collectChecks(ctx: CommandContext, deps?: CommandDeps): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const d = deps ?? (await defaultDeps(ctx));
  await ensureRoot(ctx.paths);
  checks.push(check(null, 'home', 'ok', `config dir ${ctx.paths.root}`));

  let plans: PlansFile | null = null;
  try {
    const { created } = await ensurePlans(ctx.paths);
    plans = await loadPlans(ctx.paths);
    checks.push(check(null, 'plans', 'ok', `${ctx.paths.plans} valid (schema ${plans.schemaVersion}, as of ${plans.asOf})`, created ? 'created just now with default plans; review the prices' : undefined));
    checks.push(existsSync(ctx.paths.plansSchema) ? check(null, 'plans.schema', 'ok', `${ctx.paths.plansSchema} present for editor validation`) : check(null, 'plans.schema', 'warn', 'plans.schema.json missing next to plans.json', 'run: npm run gen:schema, or copy schema/plans.schema.json from the package'));
  } catch (e) {
    checks.push(check(null, 'plans', 'fail', e instanceof PlansError ? e.message : String(e)));
  }

  try {
    await loadSettings(ctx.paths);
    checks.push(check(null, 'settings', 'ok', existsSync(ctx.paths.settings) ? `${ctx.paths.settings} valid` : 'settings.json absent, defaults in use'));
  } catch (e) {
    checks.push(check(null, 'settings', 'fail', (e as Error).message));
  }

  const { records, malformed } = await listBaseline(ctx.paths.baseline);
  checks.push(
    records.length
      ? check(null, 'baseline', malformed ? 'warn' : 'ok', `${records.length} snapshot(s)${malformed ? `, ${malformed} malformed line(s)` : ''}`)
      : check(null, 'baseline', 'warn', 'no baseline snapshots yet', 'record what you pay for today: decadra baseline add'),
  );

  try {
    const { stdout } = await execa('git', ['--version'], { timeout: 10_000 });
    checks.push(check(null, 'git', 'ok', stdout.trim()));
  } catch {
    checks.push(check(null, 'git', 'warn', 'git not found', 'commit signals in sessions will be unavailable'));
  }

  try {
    const settings = await loadSettings(ctx.paths).catch(() => null);
    const v = await ccusageVersion(settings?.ccusageBin ?? null);
    checks.push(check(null, 'ccusage', 'ok', v.startsWith('ccusage') ? v : `ccusage ${v}`, 'always invoked with --offline --timezone UTC'));
  } catch (e) {
    checks.push(check(null, 'ccusage', 'fail', `ccusage could not be run: ${(e as Error).message}`));
  }

  const priceCache = join(ctx.paths.cache, 'prices.json');
  if (existsSync(priceCache)) {
    const s = await stat(priceCache);
    const days = Math.floor((Date.now() - s.mtimeMs) / 86_400_000);
    checks.push(check(null, 'prices.cache', days > 30 ? 'warn' : 'ok', `price cache is ${days} day(s) old`));
  } else {
    checks.push(check(null, 'prices.cache', 'ok', 'no price cache; ccusage offline table and plans.json modelPricing in use', 'opt in to a refresh with: decadra prices refresh (not built yet)'));
  }

  const env = deps?.env ?? defaultDoctorEnv();
  const adapters = resolveAdapters(plans);
  // Every provider's checks are independent disk reads. Run them together, report in order.
  const perProvider = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await adapter.doctor(env);
      } catch (e) {
        return [check(adapter.id, `${adapter.id}.doctor`, 'fail', `doctor check threw: ${(e as Error).message}`)];
      }
    }),
  );
  for (const list of perProvider) checks.push(...list);

  // doctor surveys the whole machine on purpose; the reporting commands do not. Name what
  // they leave out and where that is decided, so a missing section is never a mystery.
  const cfg = await loadSettings(ctx.paths).catch(() => null);
  const shown = await visibleProviders(adapters, cfg?.providers.show ?? 'auto', new Set(records.map((r) => r.provider)), env);
  const hiddenElsewhere = adapters.filter((a) => !shown.has(a.id));
  checks.push(
    hiddenElsewhere.length
      ? check(
          null,
          'providers.visible',
          'ok',
          `assess, sessions and now cover ${adapters.filter((a) => shown.has(a.id)).map((a) => a.id).join(', ') || 'no providers'}`,
          `not covered: ${hiddenElsewhere.map((a) => a.id).join(', ')} (${hiddenReason(cfg?.providers.show ?? 'auto')}). Change with: decadra setup, or set providers.show in settings.json`,
        )
      : check(null, 'providers.visible', 'ok', 'assess, sessions and now cover every provider'),
  );

  // A reader is written against one build of someone else's tool. When that tool moves on,
  // the reader keeps parsing and quietly reads less, which is how tool calls read zero on
  // Codex 0.144.6 for weeks. Compare the pin to what the sessions on disk actually say.
  const withReaders = adapters.filter((a) => a.sessions);
  const since = new Date(Date.parse(todayUtc(d.now())) - 7 * 86_400_000).toISOString().slice(0, 10);
  const pins = await Promise.all(
    withReaders.map(async (adapter): Promise<DoctorCheck[]> => {
      const reader = adapter.sessions as NonNullable<typeof adapter.sessions>;
      try {
        const read = await reader.read({ since, until: todayUtc(d.now()), idleGapMinutes: 30 }, env);
        const seen = [...new Set(read.sessions.map((r) => r.toolVersion).filter((v): v is string => Boolean(v)))].sort();
        const pin = !seen.length
          ? check(adapter.id, `${adapter.id}.readerPin`, 'ok', `reader verified against ${reader.verifiedAgainst}; no sessions in the last 7 days to compare`)
          : seen.includes(reader.verifiedAgainst)
            ? check(adapter.id, `${adapter.id}.readerPin`, 'ok', `reader verified against ${reader.verifiedAgainst}, which matches the sessions on disk`)
            : check(
                adapter.id,
                `${adapter.id}.readerPin`,
                'warn',
                `reader verified against ${reader.verifiedAgainst}, but recent sessions were written by ${seen.join(', ')}`,
                'record shapes change between builds; re-verify the reader against a fresh capture and update verifiedAgainst',
              );
        const ttl = plans ? cacheWriteTtlCheck(adapter.id, read.sessions, plans) : null;
        return ttl ? [pin, ttl] : [pin];
      } catch (e) {
        return [check(adapter.id, `${adapter.id}.readerPin`, 'warn', `could not read a recent session to check the reader pin: ${(e as Error).message}`)];
      }
    }),
  );
  checks.push(...pins.flat());

  if (plans) {
    const { skipped } = buildPricingOverrides(plans.modelPricing);
    if (skipped.length) checks.push(check(null, 'plans.modelPricing', 'warn', `modelPricing entries with a missing price are not applied: ${skipped.join(', ')}`, 'all four prices are required; cacheWrite is charged to every cache-creation token whatever its TTL'));
    const ratios = priceRatioIssues(plans.modelPricing);
    const priced = Object.keys(plans.modelPricing).length;
    checks.push(
      ratios.length
        ? check(null, 'plans.modelPricing.ratios', 'warn', ratios.map((r) => r.message).join('; '), `these are hand-maintained in ${ctx.paths.plans} and nothing else checks them: the schema takes any number, and a rate wrong by a factor still costs more than $0, so the zero-price check never sees it`)
        : check(null, 'plans.modelPricing.ratios', 'ok', priced ? `${priced} model price(s), every cache rate within a published band of its input rate` : 'no model prices set; ccusage offline table in use'),
    );
    const config = await writeCcusageConfig(ctx.paths, plans.modelPricing);
    const today = todayUtc(d.now());
    const range = monthsBack(today, 1);
    range.since = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
    const ccusageAdapters = adapters.filter((a) => a.usage.kind === 'ccusage');
    const usages = await Promise.all(
      ccusageAdapters.map((adapter) => loadProviderUsage(adapter, range, loadOptionsFor(adapter, plans.providers[adapter.id], range, false, false), { runCcusage: d.runCcusage, now: d.now, configPath: config.path }, env)),
    );
    for (const [i, adapter] of ccusageAdapters.entries()) {
      if (adapter.usage.kind !== 'ccusage') continue;
      const usage = usages[i]!;
      const cmd = commandLine({ source: adapter.usage.source, report: 'daily', since: range.since.replace(/-/g, ''), until: today.replace(/-/g, ''), configPath: config.path });
      if (usage.error) {
        checks.push(check(adapter.id, `${adapter.id}.pricing`, 'fail', usage.error, cmd));
      } else if (usage.zeroPricedModels.length) {
        checks.push(check(adapter.id, `${adapter.id}.pricing`, 'fail', `priced at $0 with tokens present in the last 30 days: ${usage.zeroPricedModels.join(', ')}`, `add each to modelPricing in plans.json with input, output, cacheWrite, cacheRead per million tokens; cacheWrite is charged to every cache-creation token, so use the TTL your sessions actually run. ${cmd}`));
      } else {
        const days = usage.daily.length;
        checks.push(check(adapter.id, `${adapter.id}.pricing`, 'ok', days ? `${days} day(s) of usage in the last 30 days, every model priced` : 'no usage in the last 30 days', `${cmd}. ccusage may also merge a discovered config from .ccusage/ccusage.json, ~/.config/claude/ccusage.json, or ~/.claude/ccusage.json`));
      }
    }
  }
  return checks;
}

/**
 * One provider per group, decadra's own checks first, so the provider column stops repeating
 * itself down twenty-four rows and the check name gets the space it was being truncated out of.
 */
function group(checks: DoctorCheck[]): Array<[string, DoctorCheck[]]> {
  const by = new Map<string, DoctorCheck[]>();
  for (const c of checks) {
    const key = c.provider ?? '';
    const list = by.get(key);
    if (list) list.push(c);
    else by.set(key, [c]);
  }
  return [...by].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
}

/** The provider is already the heading, so it is not also the first half of every check name. */
function shortId(id: string, provider: string): string {
  return provider && id.startsWith(`${provider}.`) ? id.slice(provider.length + 1) : id;
}

export async function runDoctor(ctx: CommandContext): Promise<number> {
  const checks = await collectChecks(ctx);
  const failed = checks.some((c) => c.status === 'fail');
  if (ctx.format === 'json') {
    ctx.write(JSON.stringify({ version: ctx.version, ok: !failed, checks }, null, 2));
    return failed ? 1 : 0;
  }

  const groups = group(checks);
  const nameWidth = Math.max(...checks.map((c) => shortId(c.id, c.provider ?? '').length));
  const indent = ' '.repeat(nameWidth + 7);
  const room = Math.max(20, width() - indent.length);
  const under = (text: string): string => wrap(text, room).join('\n' + indent);
  const out: string[] = [];
  for (const [provider, list] of groups) {
    out.push(provider ? pc.bold(provider) : pc.bold('decadra'));
    for (const c of list) {
      const name = shortId(c.id, provider);
      out.push(`  ${glyph(c.status)} ${pc.dim(name.padEnd(nameWidth))}  ${under(c.summary)}`);
      if (!c.detail) continue;
      // A remedy is only actionable on a check that wants action, so a passing check gets one
      // line of it. That is what keeps a ccusage invocation from taking four rows to say a
      // check passed, without also throwing away the timestamp a discovery check puts there.
      // --json carries every detail whatever the status.
      const flat = c.detail.replace(/\s+/g, ' ').trim();
      const shown = c.status === 'ok' ? clip(flat, room) : under(c.detail);
      out.push(pc.dim(indent + shown));
    }
    out.push('');
  }

  const count = (s: DoctorCheck['status']): number => checks.filter((c) => c.status === s).length;
  const tally = [`${checks.length} checks`, `${count('ok')} ok`, `${count('warn')} warn`, `${count('fail')} fail`];
  if (count('absent')) tally.push(`${count('absent')} absent`);
  out.push(failed ? pc.red(tally.join('   ')) : tally.join('   '));
  ctx.write(out.join('\n'));
  return failed ? 1 : 0;
}
