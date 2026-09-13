import { join } from 'node:path';
import { scanDir, splitDirs } from '../../ingest/discover';
import { check, type ProviderAdapter } from '../types';
import { claudeReader } from './reader';

export const claudeCode: ProviderAdapter = {
  id: 'anthropic-claude-code',
  displayName: 'Claude',
  meter: 'usd-list',
  usage: { kind: 'ccusage', source: 'claude' },
  sessions: claudeReader,
  async doctor(env) {
    const roots = splitDirs(env.env['CLAUDE_CONFIG_DIR'], join(env.home, '.claude'));
    const out = [];
    for (const root of roots) {
      const projects = join(root, 'projects');
      // Session files sit at depth 1 (<project>/<session>.jsonl). Deeper files are subagents and are not sessions.
      const r = await scanDir(projects, (name, depth) => depth === 1 && name.endsWith('.jsonl'), 1);
      out.push(
        r.found
          ? check(this.id, 'claude.projects', r.files ? 'ok' : 'warn', `${projects}: ${r.files} session files`, r.newest ? `newest ${r.newest}` : undefined)
          : check(this.id, 'claude.projects', 'absent', `${projects} not found`),
      );
    }
    return out;
  },
  async localDataStart(env) {
    let oldest: string | null = null;
    for (const root of splitDirs(env.env['CLAUDE_CONFIG_DIR'], join(env.home, '.claude'))) {
      const r = await scanDir(join(root, 'projects'), (name, depth) => depth === 1 && name.endsWith('.jsonl'), 1);
      if (r.oldest && (!oldest || r.oldest < oldest)) oldest = r.oldest;
    }
    return oldest ? oldest.slice(0, 10) : null;
  },
};
