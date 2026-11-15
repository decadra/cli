import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const deferred = ['import', 'usage', 'prices', 'cap', 'waste', 'split'];
function cli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd, encoding: 'utf8', timeout: 10000,
  });
}

describe('implemented command surface', () => {
  it('keeps working commands in help without advertising deferred commands', () => {
    const result = cli(['--help']);
    expect(result.status).toBe(0);
    for (const name of ['baseline', 'context', 'harness', 'now', 'assess', 'sessions', 'setup', 'doctor', 'alerts', 'docs'])
      expect(result.stdout).toMatch(new RegExp(`^  ${name}(?: |$)`, 'm'));
    for (const name of deferred)
      expect(result.stdout).not.toMatch(new RegExp(`^  ${name}(?: |$)`, 'm'));
  });

  it.each(deferred)('rejects the deferred %s command instead of returning a placeholder receipt', (name) => {
    const result = cli(['--json', name]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('error: too many arguments');
    expect(result.stderr).toContain(name);
    expect(result.stdout).toBe('');
  });

});
