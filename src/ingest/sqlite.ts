import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

const loadBuiltin = createRequire(import.meta.url);

/** Provider databases are opened without write access or loadable extensions. */
export function openReadOnlyDatabase(path: string): DatabaseSync {
  const { DatabaseSync } = loadBuiltin('node:sqlite') as typeof import('node:sqlite');
  return new DatabaseSync(path, { readOnly: true, allowExtension: false });
}
