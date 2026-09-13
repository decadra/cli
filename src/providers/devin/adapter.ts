import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { check, type ProviderAdapter } from '../types';
import { devinDbPath, devinReader, readDevinMetadata, VERIFIED_AGAINST } from './reader';
import { firstDevinActivity } from './visibility';

const allDates = { since: '0000-01-01', until: '9999-12-31', idleGapMinutes: 5 };

export const devin: ProviderAdapter = {
  id: 'devin',
  displayName: 'Devin',
  meter: 'acu',
  usage: { kind: 'native' },
  sessions: devinReader,
  async localDataStart(env) {
    return firstDevinActivity(devinDbPath(env));
  },
  async doctor(env) {
    const path = devinDbPath(env);
    if (!existsSync(path)) return [check(this.id, 'devin.sessionsDb', 'absent', `${path} not found`)];
    const checks = [check(this.id, 'devin.sessionsDb', 'ok', `${path} present`)];
    const data = readDevinMetadata(allDates, env);
    checks.push(check(this.id, 'devin.readOnly', data.error ? 'warn' : 'ok', data.error ? 'database could not be read with the verified schema' : 'database opened read only', `reader verified against ${VERIFIED_AGAINST}`));
    const dates = await Promise.all([path, `${path}-wal`].map((file) => stat(file).then((s) => s.mtime.toISOString()).catch(() => null)));
    const newest = dates.filter((date): date is string => date !== null).sort().at(-1);
    checks.push(check(this.id, 'devin.sessions', data.malformedRows ? 'warn' : 'ok', `${data.sessions.length} visible sessions with activity`, `1 database${newest ? `, newest ${newest}` : ''}; ${data.malformedRows} malformed rows or chains skipped`));
    const versions = [...new Set(data.sessions.flatMap((s) => s.toolVersion ? [s.toolVersion] : []))];
    const verified = data.sessions.length > 0 && data.sessions.every((s) => s.toolVersion === VERIFIED_AGAINST);
    checks.push(check(this.id, 'devin.version', verified ? 'ok' : 'warn', verified ? 'stored tool version matches reader' : 'stored tool version is absent or differs from the reader', versions.length ? `stored ${versions.join(', ')}; verified ${VERIFIED_AGAINST}` : `no writer version recorded; reader verified against ${VERIFIED_AGAINST}`));
    return checks;
  },
};
