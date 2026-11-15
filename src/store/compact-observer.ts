import { createHash } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, basename, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import * as z from 'zod/mini';

const input = z.object({
  session_id: z.string().check(z.minLength(1), z.maxLength(256)),
  hook_event_name: z.enum(['PreCompact', 'PostCompact']),
});
const phase = z.enum(['implementation', 'verification', 'handoff']);

function canonical(path: string): string {
  try { return realpathSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path === dirname(path)) throw error;
    return join(canonical(dirname(path)), basename(path));
  }
}

function trustedRoot(path: string) {
  const root = canonical(resolve(path));
  const homes = ['.claude', '.codex', '.cursor', '.local/share/devin', '.local/share/muse'].map(p => join(homedir(), p));
  for (const value of [process.env.CODEX_HOME, process.env.CLAUDE_CONFIG_DIR])
    for (const extra of value?.split(',') ?? []) if (extra.trim()) homes.push(resolve(extra.trim()));
  const comparable = (p: string) => p.normalize('NFC').toLowerCase();
  const destination = comparable(root);
  if (homes.map(p => comparable(canonical(p))).some(p => destination === p || destination.startsWith(p + sep))) return false;
  const providerIds = new Set(homes.flatMap(home => {
    const info = statSync(home, { bigint: true, throwIfNoEntry: false });
    return info ? [info.dev + '/' + info.ino] : [];
  }));
  for (let dir = root; ; dir = dirname(dir)) {
    try {
      const info = statSync(dir);
      const identity = statSync(dir, { bigint: true });
      if (providerIds.has(identity.dev + '/' + identity.ino)) return false;
      if (!info.isDirectory()) return false;
      if (process.getuid && (info.uid !== process.getuid() && info.uid !== 0 ||
          ((info.mode & 0o022) !== 0 && !(dir !== root && info.uid === 0 && (info.mode & 0o1000))))) return false;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (dir === dirname(dir)) return root;
  }
}

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
    const destination = trustedRoot(root);
    if (!destination) return;
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    if (trustedRoot(destination) !== destination) return;
    const path = join(destination, 'compact.sqlite');
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const file = fstatSync(fd);
      if (!file.isFile() || file.nlink !== 1) return;
      fchmodSync(fd, 0o600);
    } finally {
      closeSync(fd);
    }
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
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
