import { existsSync } from 'node:fs';
import { execa } from 'execa';

/** Read-only git log over a time window in one working directory. */
export interface CommitInfo {
  hash: string;
  ts: string;
  coAuthoredByClaude: boolean;
}

export type CommitLookup = { status: 'ok'; commits: CommitInfo[] } | { status: 'missing' } | { status: 'not-a-repo' } | { status: 'error'; message: string };

export async function commitsInWindow(cwd: string, fromIso: string, toIso: string): Promise<CommitLookup> {
  if (!existsSync(cwd)) return { status: 'missing' };
  try {
    const { stdout } = await execa('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], { timeout: 10_000 });
    if (stdout.trim() !== 'true') return { status: 'not-a-repo' };
  } catch {
    return { status: 'not-a-repo' };
  }
  try {
    const { stdout } = await execa('git', ['-C', cwd, 'log', `--since=${fromIso}`, `--until=${toIso}`, '--format=%H%x1f%cI%x1f%(trailers:key=Co-Authored-By,valueonly)%x1e'], { timeout: 20_000 });
    const commits: CommitInfo[] = [];
    for (const rec of stdout.split('\x1e')) {
      const [hash, ts, trailers] = rec.trim().split('\x1f');
      if (!hash || !ts) continue;
      commits.push({ hash, ts: new Date(ts).toISOString(), coAuthoredByClaude: /claude/i.test(trailers ?? '') });
    }
    return { status: 'ok', commits };
  } catch (e) {
    return { status: 'error', message: (e as Error).message.split('\n')[0] ?? 'git log failed' };
  }
}
