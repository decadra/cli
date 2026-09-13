import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureRoot, resolvePaths } from '../src/config/paths';
import { buildPricingOverrides, writeCcusageConfig } from '../src/ingest/ccusage-config';

describe('ccusage pricing overrides', () => {
  it('converts per-million to per-token and applies only complete entries', async () => {
    const pricing = {
      'model-a': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
      'model-b': { input: 1, output: 2, cacheWrite: null, cacheRead: 0.1 },
    };
    const { overrides, skipped } = buildPricingOverrides(pricing);
    expect(skipped).toEqual(['model-b']);
    expect(overrides['model-a']).toEqual({ inputCostPerToken: 3e-6, outputCostPerToken: 15e-6, cacheCreationInputTokenCost: 3.75e-6, cacheReadInputTokenCost: 3e-7 });
    const paths = resolvePaths(await mkdtemp(join(tmpdir(), 'decadra-')));
    await ensureRoot(paths);
    const r = await writeCcusageConfig(paths, pricing);
    expect(r.path.startsWith(paths.cache)).toBe(true);
    const written = JSON.parse(await readFile(r.path, 'utf8')) as { defaults: { pricingOverrides: Record<string, unknown> } };
    expect(Object.keys(written.defaults.pricingOverrides)).toEqual(['model-a']);
  });
});
