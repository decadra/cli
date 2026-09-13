import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { appendRecord, readRecords } from '../src/store/jsonl';
import { resolvePaths } from '../src/config/paths';
import { runBaselineAdd } from '../src/commands/baseline';
import type { CommandContext } from '../src/commands/context';

const schema = z.looseObject({ n: z.number() });

describe('append-only jsonl', () => {
  it('does not join two records when the file has no trailing newline', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'decadra-')), 'x.jsonl');
    // a write cut short, or a file edited by hand, leaves the last line unterminated
    await writeFile(file, JSON.stringify({ n: 1 }));
    await appendRecord(file, { n: 2 });
    const text = await readFile(file, 'utf8');
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    const { records, malformed } = await readRecords(file, schema);
    expect(malformed).toBe(0);
    expect(records.map((r) => r.n)).toEqual([1, 2]);
  });

  it('appends normally to a file that already ends with a newline, and to an empty one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'decadra-'));
    const file = join(dir, 'y.jsonl');
    await appendRecord(file, { n: 1 });
    await appendRecord(file, { n: 2 });
    expect((await readFile(file, 'utf8')).split('\n').filter(Boolean)).toHaveLength(2);
    // the first line is byte-identical after the second write
    expect((await readFile(file, 'utf8')).startsWith('{"n":1}\n')).toBe(true);
  });
});

describe('config directory', () => {
  it('treats an empty or blank value as unset', async () => {
    const home = resolvePaths(undefined).root;
    expect(resolvePaths('').root).toBe(home);
    expect(resolvePaths('   ').root).toBe(home);
  });

  it('resolves a relative directory to an absolute one', () => {
    const paths = resolvePaths('./scratch-home');
    expect(isAbsolute(paths.root)).toBe(true);
    expect(paths.root.endsWith('scratch-home')).toBe(true);
    expect(isAbsolute(paths.plans)).toBe(true);
  });
});

describe('baseline add validation', () => {
  const ctx = (root: string, out: string[]): CommandContext => ({ paths: resolvePaths(root), format: 'json', htmlPath: undefined, write: (s) => out.push(s), version: 't' });

  it('refuses a correction that names another provider, or no snapshot at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    const out: string[] = [];
    const c = ctx(root, out);
    await runBaselineAdd(c, { provider: 'openai-codex', product: 'ChatGPT Plus', tier: 'plus', price: 20, billing: 'monthly' });
    const id = (JSON.parse(out[0] as string) as { id: string }).id;

    await expect(
      runBaselineAdd(c, { provider: 'anthropic-claude-code', product: 'Max 20x', tier: 'max20', price: 200, billing: 'monthly', supersedes: id }),
    ).rejects.toThrow(/is a openai-codex snapshot/);
    await expect(
      runBaselineAdd(c, { provider: 'openai-codex', product: 'ChatGPT Pro', tier: 'pro', price: 100, billing: 'monthly', supersedes: 'no-such-id' }),
    ).rejects.toThrow(/names no snapshot/);
  });

  it('refuses a negative price and never prompts under --json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'decadra-home-'));
    const out: string[] = [];
    await expect(runBaselineAdd(ctx(root, out), { provider: 'openai-codex', product: 'ChatGPT Plus', tier: 'plus', price: -5, billing: 'monthly' })).rejects.toThrow(/0 or more/);
    // machine output must not be interrupted by a prompt, so a gap is an error instead
    await expect(runBaselineAdd(ctx(root, out), { provider: 'openai-codex' })).rejects.toThrow(/pass every flag with --json/);
  });
});
