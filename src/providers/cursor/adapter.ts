import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { scanDir } from '../../ingest/discover';
import { check, type ProviderAdapter, type DoctorEnv } from '../types';

export function cursorStateDb(env: DoctorEnv): string {
  if (env.platform === 'darwin') return join(env.home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (env.platform === 'win32') return join(env.env['APPDATA'] ?? join(env.home, 'AppData', 'Roaming'), 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  return join(env.home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

export const cursor: ProviderAdapter = {
  id: 'cursor',
  displayName: 'Cursor',
  meter: 'usd-billed',
  usage: { kind: 'import', format: 'cursor-csv' },
  async doctor(env) {
    const transcripts = join(env.home, '.cursor', 'projects');
    const r = await scanDir(transcripts, (name, depth) => depth >= 2 && name.endsWith('.jsonl'), 4);
    const db = cursorStateDb(env);
    return [
      r.found
        ? check(this.id, 'cursor.transcripts', r.files ? 'ok' : 'warn', `${transcripts}: ${r.files} CLI transcripts`, r.newest ? `newest ${r.newest}` : undefined)
        : check(this.id, 'cursor.transcripts', 'absent', `${transcripts} not found`),
      existsSync(db)
        ? check(this.id, 'cursor.stateDb', 'ok', `${db} present`, 'opened read-only when needed')
        : check(this.id, 'cursor.stateDb', 'absent', `${db} not found`),
      check(this.id, 'cursor.import', 'warn', 'dollar figures come from the official CSV export', 'Settings, Usage, Export, then: decadra import cursor <file.csv> (not built yet)'),
    ];
  },
};
