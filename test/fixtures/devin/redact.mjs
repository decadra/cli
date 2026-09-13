// Run on a scratch copy only. Replaces content while retaining real database structure.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';

const target = process.argv[2];
if (!target || !resolve(target).startsWith('/private/tmp/')) throw new Error('Use a scratch copy under /private/tmp.');
const db = new DatabaseSync(target, { allowExtension: false });
const fake = (value) => {
  const hex = createHash('sha256').update(value).digest('hex');
  return `11111111-${hex.slice(0, 4)}-4000-8000-${hex.slice(4, 16)}`;
};
const safeStringKeys = new Set(['role', 'type', 'kind', 'generation_model', 'model', 'model_name', 'version', 'cli_version', 'name', 'finish_reason', 'tool_name']);
const clean = (value, key = '') => {
  if (typeof value === 'string') {
    if (/^(?:\d{4}-\d\d-\d\dT\d\d:\d\d:|\d{4}-\d\d-\d\d$)/.test(value)) return value;
    if (/^(?:[0-9a-f]{8}-){1}[0-9a-f-]{27}$/i.test(value) || /(?:^|_)(?:id|uuid)$/.test(key)) return fake(value);
    if (safeStringKeys.has(key) && /^[a-z0-9_.:/-]{0,100}$/i.test(value)) return value;
    if (value.startsWith('/')) return `/home/fixture/${value.split('/').filter(Boolean).map((_, i) => `path${i}`).join('/')}`;
    return '[redacted]';
  }
  if (Array.isArray(value)) return value.map((entry) => clean(entry, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
  return value;
};
const cleanText = (value, key) => {
  if (value === null) return null;
  try { return JSON.stringify(clean(JSON.parse(value), key)); } catch { return clean(value, key); }
};
db.exec('PRAGMA foreign_keys = OFF; BEGIN');
for (const row of db.prepare('SELECT * FROM sessions').all()) {
  db.prepare('UPDATE sessions SET id=?, working_directory=?, title=?, cogs_json=?, workspace_dirs=?, metadata=? WHERE id=?')
    .run(fake(row.id), clean(row.working_directory), row.title === null ? null : '[redacted]', cleanText(row.cogs_json), cleanText(row.workspace_dirs), cleanText(row.metadata), row.id);
}
for (const table of ['message_nodes', 'prompt_history', 'rendered_commits', 'tool_call_state', 'subagent_heads']) {
  for (const row of db.prepare(`SELECT rowid AS fixture_rowid, * FROM ${table}`).all()) {
    const changes = Object.entries(row).filter(([key]) => !['fixture_rowid', 'row_id', 'id'].includes(key) && typeof row[key] === 'string');
    if (!changes.length) continue;
    const values = changes.map(([key, value]) => key === 'session_id' ? fake(value) : cleanText(value, key));
    db.prepare(`UPDATE ${table} SET ${changes.map(([key]) => `${key}=?`).join(',')} WHERE rowid=?`).run(...values, row.fixture_rowid);
  }
}
db.exec('DELETE FROM app_state; COMMIT; VACUUM; PRAGMA journal_mode = DELETE');
db.close();
