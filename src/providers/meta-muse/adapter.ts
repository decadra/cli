import { join } from 'node:path';
import { scanDir } from '../../ingest/discover';
import { check, type ProviderAdapter } from '../types';

export const muse: ProviderAdapter = {
  id: 'meta-muse',
  displayName: 'Muse Code',
  meter: 'usd-list',
  usage: { kind: 'native' },
  async doctor(env) {
    const sessions = join(env.home, '.local', 'share', 'muse', 'sessions');
    // Top-level session logs sit at YYYY/MM/DD/<uuid>/session.jsonl (depth 4). Deeper ones are subagents.
    const r = await scanDir(sessions, (name, depth) => depth === 4 && name === 'session.jsonl', 4);
    return [
      r.found
        ? check(this.id, 'muse.sessions', r.files ? 'ok' : 'warn', `${sessions}: ${r.files} sessions`, r.newest ? `newest ${r.newest}` : undefined)
        : check(this.id, 'muse.sessions', 'absent', `${sessions} not found`),
    ];
  },
};
