import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecadraPaths } from '../config/paths';
import type { PlansFile } from '../config/plans';

export interface CcusageConfigResult {
  path: string;
  applied: string[];
  skipped: string[];
}

/**
 * Turns plans.json modelPricing (USD per million tokens) into ccusage
 * pricingOverrides (USD per token). An entry is applied only when all four
 * prices are present: ccusage prices 1-hour cache writes at twice the input
 * rate, so a missing input price silently prices those writes at zero.
 * cacheWrite is the 5-minute cache write price.
 */
export function buildPricingOverrides(modelPricing: PlansFile['modelPricing']): { overrides: Record<string, Record<string, number>>; skipped: string[] } {
  const overrides: Record<string, Record<string, number>> = {};
  const skipped: string[] = [];
  for (const [model, p] of Object.entries(modelPricing)) {
    if (p.input === null || p.output === null || p.cacheWrite === null || p.cacheRead === null) {
      skipped.push(model);
      continue;
    }
    overrides[model] = {
      inputCostPerToken: p.input / 1e6,
      outputCostPerToken: p.output / 1e6,
      cacheCreationInputTokenCost: p.cacheWrite / 1e6,
      cacheReadInputTokenCost: p.cacheRead / 1e6,
    };
  }
  return { overrides, skipped };
}

export async function writeCcusageConfig(paths: DecadraPaths, modelPricing: PlansFile['modelPricing']): Promise<CcusageConfigResult> {
  const { overrides, skipped } = buildPricingOverrides(modelPricing);
  const path = join(paths.cache, 'ccusage.json');
  await writeFile(path, JSON.stringify({ defaults: { pricingOverrides: overrides } }, null, 2) + '\n');
  return { path, applied: Object.keys(overrides).sort(), skipped: skipped.sort() };
}
