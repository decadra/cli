import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultPlans } from '../src/config/plans';
import { builtinAdapters, resolveAdapters } from '../src/providers/registry';

describe('provider registry', () => {
  it('ships five built-in adapters with unique kebab-case ids', () => {
    const ids = builtinAdapters.map((a) => a.id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('doctor never throws on an empty home and reports absence', async () => {
    const home = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    for (const a of builtinAdapters) {
      const checks = await a.doctor({ home, platform: 'linux', env: {} });
      expect(checks.length).toBeGreaterThan(0);
      for (const c of checks) {
        expect(c.provider).toBe(a.id);
        expect(['absent', 'warn', 'ok']).toContain(c.status);
      }
      expect(checks.some((c) => c.status === 'absent')).toBe(true);
    }
  });

  it('turns a config-declared provider into an adapter without overriding built-ins', () => {
    const plans = defaultPlans();
    plans.providers['gemini'] = { displayName: 'Gemini CLI', meter: 'usd-list', ingest: { kind: 'ccusage', source: 'gemini' }, windows: [], plans: [{ id: 'ai-pro', name: 'AI Pro', monthlyUsd: 20, allowance: { kind: 'capped-window', multiplierVsBase: 1 }, asOf: '2026-09-05' }] };
    plans.providers['cursor'] = { ...plans.providers['cursor']!, displayName: 'Overridden' };
    const adapters = resolveAdapters(plans);
    expect(adapters.map((a) => a.id)).toEqual([...adapters.map((a) => a.id)].sort());
    expect(adapters.find((a) => a.id === 'gemini')?.usage).toEqual({ kind: 'ccusage', source: 'gemini' });
    expect(adapters.find((a) => a.id === 'cursor')?.displayName).toBe('Cursor');
  });
});
