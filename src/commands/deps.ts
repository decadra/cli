import { homedir } from 'node:os';
import type { CommandContext } from './context';
import { loadSettings } from '../config/settings';
import { makeRunner, type CcusageRunner } from '../ingest/ccusage';
import type { DoctorEnv } from '../providers/types';

/** The seam tests use: a fake runner and a fixed clock instead of spawning ccusage. */
export interface CommandDeps {
  runCcusage: CcusageRunner;
  now: () => Date;
  env: DoctorEnv;
  cwd: string;
}

export async function defaultDeps(ctx: CommandContext): Promise<CommandDeps> {
  const settings = await loadSettings(ctx.paths).catch(() => null);
  return {
    runCcusage: makeRunner(settings?.ccusageBin ?? null),
    now: () => new Date(),
    env: { home: homedir(), platform: process.platform, env: process.env },
    cwd: process.cwd(),
  };
}
