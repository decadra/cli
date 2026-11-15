import { realpath } from 'node:fs/promises';
import { execa } from 'execa';
import type { SessionRecord } from '../ingest/types';

export function discoveryEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
}

async function commonDirectory(cwd: string) {
  try {
    const result = await execa('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, extendEnv: false, env: discoveryEnv() });
    return await realpath(result.stdout);
  } catch {
    return null;
  }
}

export async function sessionRepository(cwd: string) {
  const target = await commonDirectory(cwd);
  if (!target) throw new Error('Run --here inside a Git repository.');
  return target;
}

export async function repositorySessions<T extends Pick<SessionRecord, 'cwd'>>(records: T[], target: string) {
  const directories = new Map<string, boolean>();
  for (const record of records) {
    if (record.cwd && !directories.has(record.cwd)) {
      directories.set(record.cwd, await commonDirectory(record.cwd) === target);
    }
  }
  return records.filter(record => record.cwd && directories.get(record.cwd));
}
