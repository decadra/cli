import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addBaseline, currentByProvider, DuplicateBaselineError, listBaseline, type BaselineInput } from '../src/store/baseline';

const base: BaselineInput = { asOf: '2026-09-05', provider: 'anthropic-claude-code', product: 'Claude Max 20x', tier: 'max20', price: 200, currency: 'USD', billing: 'monthly' };

describe('baseline store', () => {
  it('appends and never rewrites earlier lines', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'baseline.jsonl');
    await addBaseline(file, base);
    const first = (await readFile(file, 'utf8')).split('\n')[0];
    await addBaseline(file, { ...base, provider: 'openai-codex', product: 'ChatGPT Plus', tier: 'plus', price: 20 });
    const lines = (await readFile(file, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(first);
    expect((await listBaseline(file)).records).toHaveLength(2);
  });

  it('refuses an identical snapshot unless forced', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'baseline.jsonl');
    await addBaseline(file, base);
    await expect(addBaseline(file, base)).rejects.toBeInstanceOf(DuplicateBaselineError);
    await addBaseline(file, base, { force: true });
    expect((await listBaseline(file)).records).toHaveLength(2);
  });

  it('supersedes must point at an existing id, and hides the old record from current', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'baseline.jsonl');
    await expect(addBaseline(file, { ...base, supersedes: 'nope' })).rejects.toThrow(/no snapshot/);
    const first = await addBaseline(file, base);
    const fixed = await addBaseline(file, { ...base, price: 100, tier: 'max5', product: 'Claude Max 5x', supersedes: first.id });
    const { records } = await listBaseline(file);
    const current = currentByProvider(records);
    expect(current.get('anthropic-claude-code')?.id).toBe(fixed.id);
  });

  it('counts malformed lines instead of throwing', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'baseline.jsonl');
    await addBaseline(file, base);
    const { appendFile } = await import('node:fs/promises');
    await appendFile(file, '{not json\n');
    const { records, malformed } = await listBaseline(file);
    expect(records).toHaveLength(1);
    expect(malformed).toBe(1);
  });
});
