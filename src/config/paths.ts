import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

/**
 * Every file Decadra writes lives under one directory. Resolution order:
 * an explicit --config-dir, then DECADRA_HOME, then ~/.decadra.
 * Nothing here ever points inside a provider's own data directory.
 */
export interface DecadraPaths {
  root: string;
  plans: string;
  plansSchema: string;
  settings: string;
  baseline: string;
  verdicts: string;
  alerts: string;
  manualUsage: string;
  imports: string;
  cache: string;
}

/** An empty or blank value is not a choice of directory; it is the absence of one. */
function chosen(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

export function resolvePaths(configDir?: string | undefined): DecadraPaths {
  // Relative values are resolved once, here, so every path in the app is absolute and
  // does not change meaning when a command changes directory.
  const root = resolve(chosen(configDir) ?? chosen(process.env['DECADRA_HOME']) ?? join(homedir(), '.decadra'));
  return {
    root,
    plans: join(root, 'plans.json'),
    plansSchema: join(root, 'plans.schema.json'),
    settings: join(root, 'settings.json'),
    baseline: join(root, 'baseline.jsonl'),
    verdicts: join(root, 'verdicts.jsonl'),
    alerts: join(root, 'alerts.jsonl'),
    manualUsage: join(root, 'usage-manual.jsonl'),
    imports: join(root, 'imports'),
    cache: join(root, 'cache'),
  };
}

export async function ensureRoot(paths: DecadraPaths): Promise<void> {
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.cache, { recursive: true });
  await mkdir(paths.imports, { recursive: true });
}
