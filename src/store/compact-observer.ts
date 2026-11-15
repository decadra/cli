import { createHash } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

const input = z.object({
  session_id: z.string().min(1).max(256),
  hook_event_name: z.enum(['PreCompact', 'PostCompact']),
});
const phase = z.enum(['implementation', 'verification', 'handoff']);

export async function observeCompact(root: string) {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const value = Buffer.from(chunk);
      bytes += value.length;
      if (bytes > 1024 * 1024) return;
      chunks.push(value);
    }
    const event = input.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const session = createHash('sha256').update(event.session_id).digest('hex');
    const label = phase.safeParse(process.env.DECADRA_PHASE);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const path = join(root, 'compact.sqlite');
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || file.nlink !== 1) return;
      fchmodSync(fd, 0o600);
    } finally {
      closeSync(fd);
    }
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=50; CREATE TABLE IF NOT EXISTS compact_v1 (session TEXT, kind TEXT, utc TEXT, phase TEXT); CREATE INDEX IF NOT EXISTS compact_session ON compact_v1(session)');
      db.prepare(`INSERT INTO compact_v1 (session, kind, utc, phase)
        SELECT ?, ?, ?, ? WHERE COALESCE((SELECT kind FROM compact_v1 WHERE session = ? ORDER BY rowid DESC LIMIT 1), '') <> ?`)
        .run(session, event.hook_event_name, new Date().toISOString(), label.success ? label.data : null, session, event.hook_event_name);
    } finally {
      db.close();
    }
  } catch {
    // Observation is best effort. Host payloads and storage errors must stay out of the session.
  }
}
