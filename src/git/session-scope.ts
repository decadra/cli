import { realpath } from 'node:fs/promises';
import { execa } from 'execa';
import type { SessionRecord } from '../ingest/types';

async function commonDirectory(cwd: string) {
  try {
    const result = await execa('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd });
    return await realpath(result.stdout);
  } catch {
    return null;
  }
}

export async function repositorySessions(records: SessionRecord[], cwd: string) {
  const target = await commonDirectory(cwd);
  if (!target) throw new Error('Run --here inside a Git repository.');
  const directories = new Map<string, boolean>([[cwd, true]]);
  for (const record of records) {
    if (record.cwd && !directories.has(record.cwd)) {
      directories.set(record.cwd, await commonDirectory(record.cwd) === target);
    }
  }
  return records.filter(record => record.cwd && directories.get(record.cwd));
}
