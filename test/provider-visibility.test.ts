import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAssess } from '../src/commands/assess';
import { collectChecks } from '../src/commands/doctor';
import { addBaseline } from '../src/store/baseline';
import { builtinAdapters, visibleProviders } from '../src/providers/registry';
import { harness, strip } from './harness';

const ALL = builtinAdapters.map((a) => a.id);
const env = (home: string) => ({ home, platform: 'linux' as const, env: {} });

describe('which providers a report covers', () => {
  it('hides one with no baseline and no usage data', async () => {
    const h = await harness({ show: 'auto' });
    await runAssess(h.ctx, { months: 1 }, h.deps);
    const text = strip(h.out.join('\n'));
    for (const name of ['Cursor', 'Devin', 'Muse Code']) expect(text).not.toContain(name);
  });

  it('shows one you pay for even with nothing on disk', async () => {
    const h = await harness({ show: 'auto' });
    await addBaseline(h.ctx.paths.baseline, { asOf: '2026-08-01', provider: 'cursor', product: 'Cursor Pro', tier: 'pro', price: 20, currency: 'USD', billing: 'monthly' });
    await runAssess(h.ctx, { months: 1 }, h.deps);
    expect(strip(h.out.join('\n'))).toContain('Cursor');
  });

  it('does not mistake an installed tool for a used one', async () => {
    // Devin's doctor reports its sessions.db as ok the moment the CLI has been opened once,
    // and carries a permanent warn about cloud sessions. Neither is usage, and a machine that
    // tried Devin in August should not be answering for it in September.
    const h = await harness({ show: 'auto' });
    const devin = join(h.deps.env.home, '.local', 'share', 'devin', 'cli');
    await mkdir(devin, { recursive: true });
    await writeFile(join(devin, 'sessions.db'), '');
    const shown = await visibleProviders(builtinAdapters, 'auto', new Set(), env(h.deps.env.home));
    expect(shown.has('devin')).toBe(false);

    const checks = await collectChecks(h.ctx, h.deps);
    expect(checks.some((c) => c.provider === 'devin' && c.status === 'ok')).toBe(true);
  });

  it('honours an explicit list over any detection', async () => {
    const h = await harness({ show: ['devin'] });
    await runAssess(h.ctx, { months: 1 }, h.deps);
    const text = strip(h.out.join('\n'));
    expect(text).toContain('Devin');
    expect(text).not.toContain('Claude');
  });

  it('naming a provider on the command line overrides visibility', async () => {
    const h = await harness({ show: 'auto' });
    await runAssess(h.ctx, { months: 1, provider: ['cursor'] }, h.deps);
    expect(strip(h.out.join('\n'))).toContain('Cursor');
  });

  it('never hides anything silently', async () => {
    const h = await harness({ show: ['anthropic-claude-code'] });
    await runAssess(h.ctx, { months: 1 }, h.deps);
    const text = strip(h.out.join('\n'));
    expect(text).toContain('cursor');
    expect(text).toMatch(/decadra setup|decadra doctor/);
  });

  it('gives the reason a provider was left out, not the other reason', async () => {
    // A provider hidden by an explicit list may have plenty of usage data on disk. Saying it
    // had none is false, and `decadra setup` writes a list, so it is the common case.
    const listed = await harness({ show: ['anthropic-claude-code'] });
    await runAssess(listed.ctx, { months: 1 }, listed.deps);
    const fromList = strip(listed.out.join('\n'));
    expect(fromList).toContain('not listed in providers.show');
    expect(fromList).not.toContain('no local usage data');
    const listedCheck = (await collectChecks(listed.ctx, listed.deps)).find((c) => c.id === 'providers.visible');
    expect(listedCheck?.detail).toContain('not listed in providers.show');

    const auto = await harness({ show: 'auto' });
    await runAssess(auto.ctx, { months: 1 }, auto.deps);
    expect(strip(auto.out.join('\n'))).toContain('no local usage data');
    const autoCheck = (await collectChecks(auto.ctx, auto.deps)).find((c) => c.id === 'providers.visible');
    expect(autoCheck?.detail).toContain('no local usage data');
  });

  it('doctor reports on every provider regardless, and says which the others skip', async () => {
    const h = await harness({ show: 'auto' });
    const checks = await collectChecks(h.ctx, h.deps);
    for (const id of ALL) expect(checks.some((c) => c.provider === id)).toBe(true);
    const line = checks.find((c) => c.id === 'providers.visible');
    expect(line?.detail).toContain('cursor');
  });
});
