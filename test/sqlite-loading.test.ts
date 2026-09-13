import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('does not load SQLite merely by importing the provider registry', async () => {
  const script = `await import('./src/providers/registry.ts');
    if (process.moduleLoadList.some(name => /sqlite/i.test(name))) process.exitCode = 1;`;
  const { stderr } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
  });
  expect(stderr).not.toContain('SQLite is an experimental feature');
});
