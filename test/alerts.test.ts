import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { evaluate, monthlyVerdicts, type VerdictHistoryEntry } from '../src/analysis/alert-rules';
import { ensureRoot, resolvePaths } from '../src/config/paths';
import type { CommandContext } from '../src/commands/context';
import type { CommandDeps } from '../src/commands/deps';
import { alertLine, runAlertsCheck, runAlertsSchedule, shellQuote, stableNodePath } from '../src/commands/alerts';
import { appendVerdict } from '../src/store/verdicts';
import { addBaseline } from '../src/store/baseline';

const v = (recordedAt: string, direction: VerdictHistoryEntry['direction'], best: string | null, months = 3): VerdictHistoryEntry => ({
  recordedAt,
  window: { since: recordedAt.slice(0, 8) + '01', until: recordedAt.slice(0, 10), months },
  provider: 'anthropic-claude-code',
  heldPlan: 'max20',
  heldPlanName: 'Max 20x',
  bestFitPlan: best,
  bestFitPlanName: best === 'max5' ? 'Max 5x' : best,
  direction,
  monthsOfEvidence: 2,
  evidence: [],
  confidence: 'medium',
});

const settings = { consecutiveMonths: 2, minDays: 30 };
// the plan held today: the verdicts below all point away from it
const HELD = 'max20';

describe('alert rules', () => {
  it('keeps the latest standard-window verdict per month and ignores custom windows', () => {
    const m = monthlyVerdicts([v('2026-07-03T00:00:00Z', 'hold', 'max20'), v('2026-07-20T00:00:00Z', 'downgrade', 'max5'), { ...v('2026-08-02T00:00:00Z', 'downgrade', 'max5'), window: { since: '2026-08-01', until: '2026-08-02' } }]);
    expect(m.map((x) => x.recordedAt)).toEqual(['2026-07-20T00:00:00Z']);
  });

  it('fires after N consecutive agreeing months with enough days, not before', () => {
    const none = () => null;
    expect(evaluate([v('2026-08-31T00:00:00Z', 'downgrade', 'max5')], settings, null, none, HELD)).toBeNull();
    const two = [v('2026-07-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'downgrade', 'max5')];
    expect(evaluate(two, settings, null, none, HELD)?.monthsAgreeing).toBe(2);
    expect(evaluate([v('2026-07-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'upgrade', 'max20')], settings, null, none, HELD)).toBeNull();
    expect(evaluate([v('2026-07-31T00:00:00Z', 'hold', 'max20'), v('2026-08-31T00:00:00Z', 'hold', 'max20')], settings, null, none, HELD)).toBeNull();
    const short = two.map((x) => ({ ...x, window: { ...x.window, since: '2026-08-20' } }));
    expect(evaluate(short, settings, null, none, HELD)).toBeNull();
  });

  it('cools down until the baseline changes and a verdict is recorded after it', () => {
    const two = [v('2026-07-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'downgrade', 'max5')];
    const firedAt = () => '2026-08-31T01:00:00Z';
    expect(evaluate(two, settings, null, firedAt, HELD)).toBeNull();
    expect(evaluate(two, settings, '2026-08-15T00:00:00Z', firedAt, HELD)).toBeNull();
    // The baseline changed, but every verdict predates the change, so there is no new
    // evidence to fire on. A later baseline row alone used to be enough.
    expect(evaluate(two, settings, '2026-09-01T00:00:00Z', firedAt, HELD)).toBeNull();
    const withNew = [...two, v('2026-09-30T00:00:00Z', 'downgrade', 'max5')];
    expect(evaluate(withNew, settings, '2026-09-01T00:00:00Z', firedAt, HELD)).not.toBeNull();
  });

  it('requires the agreeing months to be calendar-adjacent', () => {
    const none = () => null;
    const gap = [v('2026-05-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'downgrade', 'max5')];
    expect(evaluate(gap, settings, null, none, HELD)).toBeNull();
    const adjacent = [v('2026-07-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'downgrade', 'max5')];
    expect(evaluate(adjacent, settings, null, none, HELD)).not.toBeNull();
  });

  it('says nothing when you already hold the plan the verdicts point at', () => {
    const none = () => null;
    const two = [v('2026-07-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'downgrade', 'max5')];
    expect(evaluate(two, settings, null, none, 'max5')).toBeNull();
    expect(evaluate(two, settings, null, none, 'max20')).not.toBeNull();
  });

  it('alert line names one provider and its own plans only', () => {
    const line = alertLine('Claude', { direction: 'downgrade', bestFitPlanName: 'Max 5x', bestFitPlan: 'max5', heldPlanName: 'Max 20x', heldPlan: 'max20', monthsAgreeing: 2 });
    expect(line).toMatch(/^Claude: /);
    for (const n of ['ChatGPT', 'Cursor', 'Devin', 'Muse']) expect(line).not.toContain(n);
  });
});

describe('alerts command', () => {
  it('is quiet with nothing to fire, appends when it fires, and does not fire twice', async () => {
    const paths = resolvePaths(await mkdtemp(join(tmpdir(), 'decadra-')));
    await ensureRoot(paths);
    const out: string[] = [];
    const ctx: CommandContext = { paths, format: 'terminal', htmlPath: undefined, write: (s) => out.push(s), version: 't' };
    // the clock must sit after the baseline's real recordedAt, or the cooldown reads as lifted
    const deps: CommandDeps = { now: () => new Date(Date.now() + 60_000), env: { home: paths.root, platform: 'linux', env: {} }, cwd: '/', runCcusage: async () => ({}) };
    await addBaseline(paths.baseline, { asOf: '2026-06-01', provider: 'anthropic-claude-code', product: 'Claude Max 20x', tier: 'max20', price: 200, currency: 'USD', billing: 'monthly' });
    expect(await runAlertsCheck(ctx, deps)).toBe(0);
    expect(out).toEqual([]);
    for (const x of [v('2026-07-31T00:00:00Z', 'downgrade', 'max5'), v('2026-08-31T00:00:00Z', 'downgrade', 'max5')]) await appendVerdict(paths.verdicts, { recordedAt: x.recordedAt, window: x.window, plansAsOf: '2026-09-05', provider: x.provider, heldPlan: x.heldPlan, heldPlanName: x.heldPlanName ?? null, bestFitPlan: x.bestFitPlan, bestFitPlanName: x.bestFitPlanName ?? null, direction: x.direction, monthsOfEvidence: x.monthsOfEvidence, evidence: x.evidence, confidence: x.confidence });
    expect(await runAlertsCheck(ctx, deps)).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/Claude: on observed usage, Max 5x has fit for 2 consecutive months/);
    expect((await readFile(paths.alerts, 'utf8')).trim().split('\n')).toHaveLength(1);
    expect(await runAlertsCheck(ctx, deps)).toBe(0);
    expect(out).toHaveLength(1);
  });

  it('schedule prints a platform entry and refuses to install', () => {
    const paths = resolvePaths('/tmp/x');
    const out: string[] = [];
    const ctx: CommandContext = { paths, format: 'terminal', htmlPath: undefined, write: (s) => out.push(s), version: 't' };
    expect(runAlertsSchedule(ctx, { weekly: true, print: true }, 'linux', '/usr/bin/node', '/opt/decadra/cli.js')).toBe(0);
    expect(out[0]).toMatch(/0 9 \* \* 1 '\/usr\/bin\/node' '\/opt\/decadra\/cli\.js' 'alerts' 'check'/);
    out.length = 0;
    runAlertsSchedule(ctx, { daily: true, print: true }, 'darwin', '/usr/bin/node', '/opt/decadra/cli.js');
    expect(out[0]).toContain('<plist');
    expect(() => runAlertsSchedule(ctx, { weekly: true }, 'linux', 'n', 'c')).toThrow(/--print/);
  });
});

describe('alerts schedule', () => {
  const ctx = (root: string): CommandContext => ({ paths: resolvePaths(root), format: 'terminal', htmlPath: undefined, write: (t) => lines.push(t), version: 't' });
  let lines: string[] = [];
  beforeEach(() => {
    lines = [];
  });

  it('keeps a path with spaces and quotes intact in both formats', () => {
    const root = '/Users/a b/Library/Application Support/decadra';
    const cli = '/Users/a b/tools/decadra & co/dist/cli.js';
    runAlertsSchedule(ctx(root), { print: true, weekly: true }, 'darwin', '/usr/bin/node', cli, () => false);
    const plist = lines.join('\n');
    // one <string> per argument, and the ampersand escaped rather than closing the tag
    expect(plist).toContain('<string>/Users/a b/tools/decadra &amp; co/dist/cli.js</string>');
    expect(plist).toContain('<string>alerts</string><string>check</string>');
    expect(plist).toContain('<key>StandardOutPath</key>');

    lines = [];
    runAlertsSchedule(ctx(root), { print: true, daily: true }, 'linux', '/usr/bin/node', cli, () => false);
    expect(lines.join('\n')).toContain("'/Users/a b/tools/decadra & co/dist/cli.js'");
  });

  it('prefers the stable node path over a versioned Cellar directory', () => {
    const cellar = '/opt/homebrew/Cellar/node/26.0.0/bin/node';
    // the next brew upgrade removes that directory; the prefix symlink survives
    expect(stableNodePath(cellar, (p) => p === '/opt/homebrew/bin/node')).toBe('/opt/homebrew/bin/node');
    expect(stableNodePath(cellar, () => false)).toBe(cellar);
    expect(stableNodePath('/usr/bin/node', () => true)).toBe('/usr/bin/node');
  });

  it('shell-quotes an argument containing a single quote', () => {
    expect(shellQuote("/a/it's/node")).toBe(`'/a/it'\\''s/node'`);
  });
});
