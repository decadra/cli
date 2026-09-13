import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import { blocksOutput, dailyOutput, normalizeDaily, normalizeSession, sessionOutput, type NormalizedDaily, type NormalizedSession } from './ccusage.schema';
import type { BlockLite } from '../analysis/windows';

export type CcusageReport = 'daily' | 'session' | 'blocks' | 'monthly';

export interface CcusageInvocation {
  source: string;
  report: CcusageReport;
  /** YYYYMMDD */
  since?: string | undefined;
  until?: string | undefined;
  configPath?: string | undefined;
  /** Blocks only: window length in hours, from the plan's short window. */
  sessionLengthHours?: number | undefined;
}

/**
 * Builds the argument list for every ccusage call. --offline and --timezone UTC
 * are unconditional: the no-network constraint and the UTC rule live here.
 * --mode calculate (list price from tokens, ignoring any recorded cost) exists
 * only on the claude source; codex has no mode flag.
 */
export function buildCcusageArgs(inv: CcusageInvocation): string[] {
  const args = [inv.source, inv.report, '--json', '--offline', '--timezone', 'UTC'];
  if (inv.source === 'claude') args.push('--mode', 'calculate');
  if (inv.since) args.push('--since', inv.since);
  if (inv.until) args.push('--until', inv.until);
  if (inv.configPath) args.push('--config', inv.configPath);
  if (inv.report === 'blocks' && inv.sessionLengthHours) args.push('--session-length', String(inv.sessionLengthHours));
  return args;
}

export function ccusageBinPath(override?: string | null): string {
  if (override) return override;
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('ccusage/package.json');
  const pkg = require(pkgPath) as { bin?: Record<string, string> | string };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.['ccusage'] ?? 'src/cli.js');
  return join(dirname(pkgPath), bin);
}

export type CcusageRunner = (inv: CcusageInvocation) => Promise<unknown>;

export class CcusageError extends Error {
  constructor(message: string, readonly source: string, readonly args: string[]) {
    super(message);
    this.name = 'CcusageError';
  }
}

/**
 * The bundled entry is a .js file and needs node. A `ccusageBin` override may be a shim, a
 * wrapper script with its own shebang, or a compiled binary, none of which node can run.
 */
export function runsUnderNode(bin: string): boolean {
  return /\.[cm]?js$/.test(bin);
}

function spawnArgs(bin: string, args: string[]): [string, string[]] {
  return runsUnderNode(bin) ? [process.execPath, [bin, ...args]] : [bin, args];
}

export function commandLine(inv: CcusageInvocation, override?: string | null): string {
  const [cmd, args] = spawnArgs(ccusageBinPath(override), buildCcusageArgs(inv));
  return [cmd, ...args].join(' ');
}

/** Everything execa knows about a failure. The first line alone loses the reason. */
export function execaDetail(e: unknown): string {
  const err = e as { shortMessage?: unknown; stderr?: unknown; message?: unknown };
  const head = typeof err.shortMessage === 'string' ? err.shortMessage : typeof err.message === 'string' ? err.message : String(e);
  const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
  return stderr ? `${head}\n${stderr.slice(0, 4000)}` : head;
}

export function makeRunner(override?: string | null): CcusageRunner {
  const bin = ccusageBinPath(override);
  return async (inv) => {
    const args = buildCcusageArgs(inv);
    const [cmd, argv] = spawnArgs(bin, args);
    try {
      const { stdout } = await execa(cmd, argv, { timeout: 120_000 });
      return JSON.parse(stdout) as unknown;
    } catch (e) {
      throw new CcusageError(`ccusage ${inv.source} ${inv.report} failed: ${execaDetail(e)}`, inv.source, args);
    }
  };
}

export async function ccusageVersion(override?: string | null): Promise<string> {
  const [cmd, argv] = spawnArgs(ccusageBinPath(override), ['--version']);
  const { stdout } = await execa(cmd, argv, { timeout: 20_000 });
  return stdout.trim();
}

function parseOr<T>(what: string, inv: CcusageInvocation, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    throw new CcusageError(`ccusage ${inv.source} ${inv.report} returned an unexpected ${what} shape: ${(e as Error).message.split('\n')[0]}`, inv.source, buildCcusageArgs(inv));
  }
}

export async function fetchDaily(run: CcusageRunner, inv: Omit<CcusageInvocation, 'report'>): Promise<NormalizedDaily[]> {
  const full: CcusageInvocation = { ...inv, report: 'daily' };
  const raw = await run(full);
  return parseOr('daily', full, () => dailyOutput.parse(raw).daily.map(normalizeDaily));
}

export async function fetchSessions(run: CcusageRunner, inv: Omit<CcusageInvocation, 'report'>): Promise<NormalizedSession[]> {
  const full: CcusageInvocation = { ...inv, report: 'session' };
  const raw = await run(full);
  return parseOr('session', full, () => sessionOutput.parse(raw).sessions.map(normalizeSession));
}

export async function fetchBlocks(run: CcusageRunner, inv: Omit<CcusageInvocation, 'report'>): Promise<BlockLite[]> {
  const full: CcusageInvocation = { ...inv, report: 'blocks' };
  const raw = await run(full);
  return parseOr('blocks', full, () => blocksOutput.parse(raw).blocks.map((b) => ({ costUSD: b.costUSD, isGap: b.isGap, entries: b.entries, isActive: b.isActive })));
}
