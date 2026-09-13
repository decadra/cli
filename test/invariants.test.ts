import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Static invariants over the source tree. See docs/testing/invariants.md. */
const SRC = fileURLToPath(new URL('../src', import.meta.url));

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(full)));
    else if (e.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('invariants', () => {
  it('fetch appears only under src/net', async () => {
    for (const f of await files(SRC)) {
      const rel = relative(SRC, f);
      if (rel.startsWith('net/')) continue;
      expect(await readFile(f, 'utf8'), rel).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it('providers and ingest never write files, except the ccusage config under cache', async () => {
    const WRITES = /\b(writeFile|appendFile|writeFileSync|appendFileSync|mkdir|mkdirSync|rm|rmSync|unlink|rename|truncate|createWriteStream)\s*\(/;
    for (const f of await files(SRC)) {
      const rel = relative(SRC, f);
      if (!rel.startsWith('providers/') && !rel.startsWith('ingest/')) continue;
      if (rel === 'ingest/ccusage-config.ts') continue;
      expect(await readFile(f, 'utf8'), rel).not.toMatch(WRITES);
    }
  });

  it('analysis imports no filesystem, process, provider, or store module', async () => {
    for (const f of await files(join(SRC, 'analysis'))) {
      const text = await readFile(f, 'utf8');
      expect(text, f).not.toMatch(/from ['"](node:fs|node:fs\/promises|node:child_process|execa)['"]/);
      expect(text, f).not.toMatch(/from ['"]\.\.\/(providers|store|net|git|ingest\/ccusage)/);
    }
  });

  it('exit codes are never chosen inside a provider', async () => {
    for (const f of await files(join(SRC, 'providers'))) {
      expect(await readFile(f, 'utf8'), f).not.toMatch(/exitCode|process\.exit/);
    }
  });

  it('no runtime banned-phrase scan exists in the report layer', async () => {
    for (const f of await files(join(SRC, 'report'))) {
      const text = await readFile(f, 'utf8');
      expect(text, f).not.toMatch(/process\.exit/);
      expect(text, f).not.toMatch(/switch to|cheaper than|better than/);
    }
  });

  it('every provider adapter declares the required fields', async () => {
    const { builtinAdapters } = await import('../src/providers/registry');
    for (const a of builtinAdapters) {
      expect(a.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(a.displayName.length).toBeGreaterThan(0);
      expect(['usd-list', 'usd-billed', 'acu']).toContain(a.meter);
      expect(typeof a.doctor).toBe('function');
    }
  });
});

describe('no version promises in output', () => {
  it('no source file names a decadra version', async () => {
    // A promised version rots on release day, and one of these strings is persisted to
    // verdicts.jsonl, which is append only. See docs/decisions/0007.
    for (const f of await files(SRC)) {
      const text = (await readFile(f, 'utf8'))
        .replace(/\/\*[\s\S]*?\*\//g, '') // a comment may cite the vendor build a reader was checked against
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/verifiedAgainst:\s*'[^']*'/g, ''); // readers pin that build in code too
      expect(text, relative(SRC, f)).not.toMatch(/\b\d+\.\d+\.\d+\b/);
    }
  });

  it('no source file points at docs/PLAN.md, which does not exist', async () => {
    for (const f of await files(SRC)) {
      expect(await readFile(f, 'utf8'), relative(SRC, f)).not.toContain('docs/PLAN.md');
    }
  });
});
