import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const BUDGET_LINES = 200;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (/reader.*\.ts$/.test(e.name) || /-reader\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

describe('reader budget', () => {
  it('every provider reader stays under the line budget and never prices or fetches', async () => {
    const readers = await walk(fileURLToPath(new URL('../src/providers', import.meta.url)));
    for (const file of readers) {
      const text = await readFile(file, 'utf8');
      expect(text.split('\n').length, file).toBeLessThanOrEqual(BUDGET_LINES);
      expect(text, file).not.toMatch(/\bfetch\s*\(/);
      expect(text, file).not.toMatch(/usdPer|pricePer|costUsd\s*=/);
      expect(text, file).not.toMatch(/better-sqlite3|sqlite3['"]/);
    }
  });
});
