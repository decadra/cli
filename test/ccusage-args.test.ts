import { describe, expect, it } from 'vitest';
import { buildCcusageArgs, ccusageBinPath, execaDetail, runsUnderNode } from '../src/ingest/ccusage';

describe('ccusage invocation', () => {
  it('always passes --offline and --timezone UTC, and --mode calculate only where it exists', () => {
    for (const report of ['daily', 'session', 'blocks', 'monthly'] as const) {
      for (const source of ['claude', 'codex']) {
        const args = buildCcusageArgs({ source, report, since: '20260601', until: '20260905' });
        expect(args).toContain('--offline');
        expect(args.slice(args.indexOf('--timezone'), args.indexOf('--timezone') + 2)).toEqual(['--timezone', 'UTC']);
        expect(args).toContain('--json');
        expect(args.slice(0, 2)).toEqual([source, report]);
        expect(args.includes('--mode')).toBe(source === 'claude');
      }
    }
    expect(buildCcusageArgs({ source: 'claude', report: 'blocks', sessionLengthHours: 5 })).toContain('--session-length');
    expect(buildCcusageArgs({ source: 'claude', report: 'daily', sessionLengthHours: 5 })).not.toContain('--session-length');
  });
  it('resolves the bundled binary, not a global one', () => {
    expect(ccusageBinPath()).toMatch(/node_modules[\\/]ccusage[\\/]/);
    expect(ccusageBinPath('/custom/ccusage')).toBe('/custom/ccusage');
  });
});

describe('running the ccusage binary', () => {
  it('runs a .js entry under node and anything else directly', () => {
    expect(runsUnderNode('/x/node_modules/ccusage/src/cli.js')).toBe(true);
    expect(runsUnderNode('/x/cli.mjs')).toBe(true);
    // a shim, a wrapper with its own shebang, or a compiled binary: node cannot run these
    expect(runsUnderNode('/opt/homebrew/bin/ccusage')).toBe(false);
    expect(runsUnderNode('C:\\tools\\ccusage.exe')).toBe(false);
  });

  it('keeps stderr and the short message, not just the first line', () => {
    const detail = execaDetail({ shortMessage: 'Command failed with exit code 1', stderr: 'Error: unknown flag --nope\n  at main', message: 'long multiline\nmessage' });
    expect(detail).toContain('Command failed with exit code 1');
    expect(detail).toContain('unknown flag --nope');
    expect(execaDetail(new Error('plain failure'))).toBe('plain failure');
  });
});
