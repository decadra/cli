import { join } from 'node:path';
import { scanDir, splitDirs } from '../../ingest/discover';
import { check, type ProviderAdapter } from '../types';
import { codexReader } from './reader';

export const codex: ProviderAdapter = {
  id: 'openai-codex',
  displayName: 'ChatGPT',
  meter: 'usd-list',
  usage: { kind: 'ccusage', source: 'codex' },
  sessions: codexReader,
  async doctor(env) {
    const roots = splitDirs(env.env['CODEX_HOME'], join(env.home, '.codex'));
    const out = [];
    for (const root of roots) {
      for (const sub of ['sessions', 'archived_sessions']) {
        const dir = join(root, sub);
        const r = await scanDir(dir, (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), 4);
        if (!r.found) {
          out.push(check(this.id, `codex.${sub}`, 'absent', `${dir} not found`));
          continue;
        }
        out.push(check(this.id, `codex.${sub}`, r.files ? 'ok' : 'warn', `${dir}: ${r.files} rollouts`, r.newest ? `newest ${r.newest}` : undefined));
      }
    }
    return out;
  },
  async localDataStart(env) {
    let oldest: string | null = null;
    for (const root of splitDirs(env.env['CODEX_HOME'], join(env.home, '.codex'))) {
      for (const sub of ['sessions', 'archived_sessions']) {
        const r = await scanDir(join(root, sub), (name) => name.startsWith('rollout-') && name.endsWith('.jsonl'), 4);
        if (r.oldest && (!oldest || r.oldest < oldest)) oldest = r.oldest;
      }
    }
    return oldest ? oldest.slice(0, 10) : null;
  },
};
