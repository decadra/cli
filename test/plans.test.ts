import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePaths, ensureRoot } from '../src/config/paths';
import { defaultPlans, ensurePlans, jsonSchema, loadPlans, PlansError, plansFileSchema, priceRatioIssues } from '../src/config/plans';

async function freshPaths() {
  const p = resolvePaths(await mkdtemp(join(tmpdir(), 'decadra-')));
  await ensureRoot(p);
  return p;
}

describe('plans.json', () => {
  it('default content validates against its own schema', () => {
    expect(plansFileSchema.safeParse(defaultPlans()).success).toBe(true);
  });

  it('is created once and never overwritten', async () => {
    const p = await freshPaths();
    expect((await ensurePlans(p)).created).toBe(true);
    await writeFile(p.plans, JSON.stringify({ ...defaultPlans(), asOf: '2030-01-01' }, null, 2));
    expect((await ensurePlans(p)).created).toBe(false);
    expect((await loadPlans(p)).asOf).toBe('2030-01-01');
  });

  it('reports the json path of a validation error', async () => {
    const p = await freshPaths();
    const bad = defaultPlans() as unknown as { providers: Record<string, { plans: Array<{ monthlyUsd: unknown }> }> };
    bad.providers['cursor']!.plans[0]!.monthlyUsd = 'twenty';
    await writeFile(p.plans, JSON.stringify(bad));
    await expect(loadPlans(p)).rejects.toThrow(/providers\.cursor\.plans\.0\.monthlyUsd/);
    await expect(loadPlans(p)).rejects.toBeInstanceOf(PlansError);
  });

  it('rejects unknown keys so typos are caught', async () => {
    const p = await freshPaths();
    await writeFile(p.plans, JSON.stringify({ ...defaultPlans(), curency: 'USD' }));
    await expect(loadPlans(p)).rejects.toThrow(/curency/);
  });

  it('committed schema/plans.schema.json matches the zod definition', async () => {
    const committed = JSON.parse(await readFile(new URL('../schema/plans.schema.json', import.meta.url), 'utf8')) as unknown;
    expect(committed).toEqual(jsonSchema());
  });
});

describe('model price ratios', () => {
  const price = (input: number, cacheWrite: number, cacheRead: number) => ({ input, output: input * 5, cacheWrite, cacheRead });

  it('flags a cache read priced far below any published rate', () => {
    // the rate this machine carried: 0.25 against an input of 10 is 2.5%, where vendors publish
    // near 10%. It is wrong by 4x on the largest single cost line and still costs more than $0,
    // so every other check passes it.
    const issues = priceRatioIssues({ 'a-model': price(10, 12.5, 0.25) });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe('cacheRead');
    expect(issues[0]!.ratio).toBeCloseTo(0.025, 5);
    expect(issues[0]!.message).toContain('a-model');
  });

  it('accepts both published cache-write TTLs and a normal cache read', () => {
    expect(priceRatioIssues({ 'five-minute': price(10, 12.5, 1) })).toEqual([]);
    expect(priceRatioIssues({ 'one-hour': price(10, 20, 1) })).toEqual([]);
  });

  it('flags a cache write off by an order of magnitude in either direction', () => {
    expect(priceRatioIssues({ m: price(10, 125, 1) })[0]!.field).toBe('cacheWrite');
    expect(priceRatioIssues({ m: price(10, 1.25, 1) })[0]!.field).toBe('cacheWrite');
  });

  it('says nothing when a price is null or the input price is unusable', () => {
    expect(priceRatioIssues({ m: { input: null, output: null, cacheWrite: null, cacheRead: null } })).toEqual([]);
    expect(priceRatioIssues({ m: { input: 0, output: 1, cacheWrite: 99, cacheRead: 99 } })).toEqual([]);
    expect(priceRatioIssues({ m: { input: 10, output: 50, cacheWrite: null, cacheRead: 1 } })).toEqual([]);
  });

  it('reports every offending model in a stable order', () => {
    const issues = priceRatioIssues({ zeta: price(10, 12.5, 0.25), alpha: price(10, 0.5, 0.25) });
    expect(issues.map((i) => `${i.model}.${i.field}`)).toEqual(['alpha.cacheRead', 'alpha.cacheWrite', 'zeta.cacheRead']);
  });
});
