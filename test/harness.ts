import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRoot, resolvePaths } from '../src/config/paths';
import type { CommandContext } from '../src/commands/context';
import type { CommandDeps } from '../src/commands/deps';
import type { CcusageInvocation } from '../src/ingest/ccusage';
import { builtinAdapters } from '../src/providers/registry';
import { defaultSettings } from '../src/config/settings';

/** Shared command harness: temp config dir, temp home, fake ccusage keyed on source and report, fixed clock. */
export async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(new URL(`./fixtures/ccusage/${name}.json`, import.meta.url), 'utf8'));
}

export interface Harness {
  ctx: CommandContext;
  deps: CommandDeps;
  out: string[];
  calls: CcusageInvocation[];
}

export interface HarnessOptions {
  failSource?: string;
  daily?: unknown;
  codexEmpty?: boolean;
  claudeEmpty?: boolean;
  now?: string;
  /**
   * Which providers the reporting commands should cover. Defaults to all of them: a temp home
   * has no local data and no baseline, so `auto` would hide everything and tests about
   * rendering would assert on an empty report. Pass 'auto' to exercise visibility itself.
   */
  show?: 'auto' | string[];
}

export async function harness(opts: HarnessOptions = {}): Promise<Harness> {
  const paths = resolvePaths(await mkdtemp(join(tmpdir(), 'decadra-')));
  await ensureRoot(paths);
  const out: string[] = [];
  const calls: CcusageInvocation[] = [];
  const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
  await writeFile(paths.settings, JSON.stringify({ ...defaultSettings(), providers: { show: opts.show ?? builtinAdapters.map((a) => a.id) } }, null, 2) + '\n');
  const deps: CommandDeps = {
    now: () => new Date(opts.now ?? '2026-09-05T12:00:00Z'),
    env: { home, platform: 'linux', env: {} },
    cwd: '/work/proj',
    runCcusage: async (inv) => {
      calls.push(inv);
      if (inv.source === opts.failSource) throw new Error('boom');
      if (inv.source === 'codex') return fixture(opts.codexEmpty ? (inv.report === 'session' ? 'codex-session-empty' : 'codex-daily-empty') : inv.report === 'session' ? 'codex-session' : 'codex-daily');
      if (opts.claudeEmpty) return inv.report === 'session' ? { sessions: [] } : inv.report === 'blocks' ? { blocks: [] } : { daily: [] };
      if (inv.report === 'daily') return opts.daily ?? fixture('claude-daily');
      return fixture(`claude-${inv.report}`);
    },
  };
  return { ctx: { paths, format: 'terminal', htmlPath: undefined, write: (s) => out.push(s), version: 'test' }, deps, out, calls };
}

// eslint-disable-next-line no-control-regex
export const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** A priced multi-month daily series in the Claude row shape. */
export function dailySeries(months: string[], costPerDay: number, model = 'm'): { daily: unknown[] } {
  return {
    daily: months.flatMap((m) =>
      Array.from({ length: 28 }, (_, i) => ({
        date: `${m}-${String(i + 1).padStart(2, '0')}`,
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 2,
        totalCost: costPerDay,
        modelsUsed: [model],
        modelBreakdowns: [{ modelName: model, inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, cost: costPerDay }],
      })),
    ),
  };
}
