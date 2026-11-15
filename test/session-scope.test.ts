import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { discoveryEnv, repositorySessions, sessionRepository } from '../src/git/session-scope';

it('keeps linked worktrees and excludes unrelated repositories despite inherited Git overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'decadra-scope-'));
  const a = join(dir, 'a'), b = join(dir, 'b'), linked = join(dir, 'linked');
  const git = (args: string[]) => execFileSync('git', args, { env: discoveryEnv(), stdio: 'ignore' });
  const previous = process.env.GIT_DIR;
  try {
    git(['init', '-q', a]);
    git(['init', '-q', b]);
    git(['-C', a, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base']);
    git(['-C', a, 'worktree', 'add', '--detach', linked]);
    process.env.GIT_DIR = join(a, '.git');
    expect(await repositorySessions([{ cwd: a }, { cwd: b }, { cwd: linked }], await sessionRepository(a))).toEqual([{ cwd: a }, { cwd: linked }]);
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
