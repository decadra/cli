import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import pc from 'picocolors';
import { ensureRoot } from '../config/paths';
import { ensurePlans, loadPlans } from '../config/plans';
import { loadSettings } from '../config/settings';
import { evaluate, type VerdictHistoryEntry } from '../analysis/alert-rules';
import { resolveAdapters } from '../providers/registry';
import { readRecords } from '../store/jsonl';
import { heldOn, listBaseline } from '../store/baseline';
import { verdictRecordSchema } from '../store/verdicts';
import { appendAlert, listAlerts, type AlertRecord } from '../store/alerts';
import { CliError, type CommandContext } from './context';
import { defaultDeps, type CommandDeps } from './deps';
import { todayUtc } from '../analysis/months';

/** Fixed template: one provider, its own plans, nothing else. */
export function alertLine(displayName: string, c: { direction: string; bestFitPlanName: string | null; bestFitPlan: string; heldPlanName: string | null; heldPlan: string | null; monthsAgreeing: number }): string {
  const best = c.bestFitPlanName ?? c.bestFitPlan;
  const held = c.heldPlanName ?? c.heldPlan ?? 'no plan recorded';
  return `${displayName}: on observed usage, ${best} has fit for ${c.monthsAgreeing} consecutive months while you hold ${held} (${c.direction}). Run decadra assess for the math.`;
}

/**
 * Idempotent and quiet: exits 0 with no output when nothing fires, so it is
 * safe under cron or launchd. Fired alerts are appended to alerts.jsonl.
 */
export async function runAlertsCheck(ctx: CommandContext, deps?: CommandDeps): Promise<number> {
  const d = deps ?? (await defaultDeps(ctx));
  await ensureRoot(ctx.paths);
  await ensurePlans(ctx.paths);
  const plans = await loadPlans(ctx.paths);
  const settings = await loadSettings(ctx.paths);
  const { records: history } = await readRecords(ctx.paths.verdicts, verdictRecordSchema);
  const { records: baseline } = await listBaseline(ctx.paths.baseline);
  const fired = await listAlerts(ctx.paths.alerts);
  const out: AlertRecord[] = [];
  for (const adapter of resolveAdapters(plans)) {
    const mine = history.filter((v) => v.provider === adapter.id) as VerdictHistoryEntry[];
    const lastBaseline = baseline.filter((b) => b.provider === adapter.id).map((b) => b.recordedAt).sort().pop() ?? null;
    const heldNow = heldOn(baseline, adapter.id, todayUtc(d.now()))?.tier ?? null;
    const c = evaluate(
      mine,
      settings.alerts,
      lastBaseline,
      (direction, plan) => fired.filter((a) => a.provider === adapter.id && a.direction === direction && a.bestFitPlan === plan).map((a) => a.firedAt).sort().pop() ?? null,
      heldNow,
    );
    if (!c) continue;
    const record: AlertRecord = { firedAt: d.now().toISOString(), provider: c.provider, direction: c.direction, bestFitPlan: c.bestFitPlan, heldPlan: c.heldPlan, monthsAgreeing: c.monthsAgreeing, basedOn: c.basedOn, message: alertLine(adapter.displayName, c) };
    await appendAlert(ctx.paths.alerts, record);
    out.push(record);
  }
  if (ctx.format === 'json') ctx.write(JSON.stringify({ fired: out }, null, 2));
  else for (const r of out) ctx.write(pc.yellow(r.message));
  return 0;
}

export async function runAlertsList(ctx: CommandContext): Promise<number> {
  const alerts = await listAlerts(ctx.paths.alerts);
  if (ctx.format === 'json') ctx.write(JSON.stringify({ alerts }, null, 2));
  else if (!alerts.length) ctx.write('no alerts fired yet');
  else for (const a of alerts) ctx.write(`${a.firedAt.slice(0, 10)}  ${a.message}`);
  return 0;
}

const scheduleOptions = z.strictObject({ weekly: z.boolean().optional(), daily: z.boolean().optional(), print: z.boolean().optional() });

/**
 * Homebrew's process.execPath points inside a versioned Cellar directory that the next
 * `brew upgrade node` deletes, which makes a scheduled job fail silently months later.
 * The symlink in the prefix survives upgrades.
 */
export function stableNodePath(execPath: string, exists: (p: string) => boolean): string {
  const m = /^(.*)\/Cellar\/node(?:@[^/]*)?\/[^/]+\/bin\/node$/.exec(execPath);
  if (!m) return execPath;
  const candidate = `${m[1] as string}/bin/node`;
  return exists(candidate) ? candidate : execPath;
}

function xmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Single-quote for a shell, so a path with a space or a quote survives crontab. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Prints the platform entry that would run `decadra alerts check`. Writing it is a system change and is not done here. */
export function runAlertsSchedule(ctx: CommandContext, rawOpts: unknown, platform: NodeJS.Platform, execPath: string, cliPath: string, exists: (p: string) => boolean = existsSync): number {
  const opts = scheduleOptions.parse(rawOpts);
  if (!opts.print) throw new CliError('alerts schedule only prints the entry for now; pass --print and install it yourself');
  const daily = opts.daily === true;
  // An argv array, never a command string: splitting on spaces broke every path with one.
  const argv = [stableNodePath(execPath, exists), cliPath, 'alerts', 'check', '--config-dir', ctx.paths.root];
  if (platform === 'darwin') {
    const interval = daily ? '<key>Hour</key><integer>9</integer>' : '<key>Weekday</key><integer>1</integer><key>Hour</key><integer>9</integer>';
    const log = join(ctx.paths.root, 'alerts.log');
    ctx.write(`# ~/Library/LaunchAgents/dev.decadra.alerts.plist, then: launchctl load ~/Library/LaunchAgents/dev.decadra.alerts.plist
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>dev.decadra.alerts</string>
  <key>ProgramArguments</key><array>${argv.map((a) => `<string>${xmlText(a)}</string>`).join('')}</array>
  <key>StartCalendarInterval</key><dict>${interval}</dict>
  <key>StandardOutPath</key><string>${xmlText(log)}</string>
  <key>StandardErrorPath</key><string>${xmlText(log)}</string>
</dict></plist>`);
  } else {
    ctx.write(`# crontab -e, then add:\n${daily ? '0 9 * * *' : '0 9 * * 1'} ${argv.map(shellQuote).join(' ')}`);
  }
  return 0;
}
