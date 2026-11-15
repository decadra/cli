import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { repositoryDirectories } from '../git/harness';
import { parse } from 'smol-toml';
import { z } from 'zod';
import type { CommandContext } from './context';

const settings = z.object({
  model_auto_compact_token_limit: z.union([z.number().int().positive(), z.bigint().positive().transform(String)]).optional(),
  model_auto_compact_token_limit_scope: z.string().optional(),
});

async function savedLayer(path: string, scope: string) {
  try {
    const config = settings.parse(parse(await readFile(path, 'utf8'), { integersAsBigInt: 'asNeeded' }));
    return { scope, path, state: 'read', thresholdTokens: config.model_auto_compact_token_limit ?? null,
      countingScope: config.model_auto_compact_token_limit_scope ?? null };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { scope, path, state: missing ? 'missing' : 'unreadable', thresholdTokens: null, countingScope: null };
  }
}

export async function runContextStatus(ctx: CommandContext, cwd = process.cwd()) {
  const layers = [await savedLayer(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'global')];
  // Walk back to the repository boundary before reporting nested overrides.
  const directories = await repositoryDirectories(cwd);
  const root = directories[0];
  for (const directory of directories) {
    const layer = await savedLayer(join(directory, '.codex', 'config.toml'), directory === root ? 'project' : 'nested');
    if (layer.scope === 'project' || layer.state !== 'missing') layers.push(layer);
  }
  const status = { provider: 'codex', runtimeThreshold: 'unknown', layers };
  if (ctx.format === 'json') return ctx.write(JSON.stringify(status));
  ctx.write('Codex saved compaction settings');
  for (const layer of layers) {
    const threshold = layer.state === 'unreadable' ? 'threshold unknown' : layer.thresholdTokens === null ? 'threshold unspecified' : layer.thresholdTokens + ' tokens';
    ctx.write(`${layer.scope}  ${layer.path}  ${layer.state}  ${threshold}  counting scope: ${layer.countingScope ?? 'unspecified'}`);
  }
  ctx.write('Active session threshold unknown.');
  ctx.write('With the separate auto-compact skill installed, use $auto-compact:auto-compact status to inspect or choose a scoped setting.');
}
