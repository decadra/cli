import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openReadOnlyDatabase } from '../src/ingest/sqlite';
import { devin } from '../src/providers/devin/adapter';
import { readDevinMetadata, devinDbPath, devinReader } from '../src/providers/devin/reader';
import { mainChain, nodeSchema, NODE_QUERY } from '../src/providers/devin/metadata';
import { CONTENT_PLACEHOLDERS } from './placeholders';

const fixture = fileURLToPath(new URL('./fixtures/devin/sessions.db', import.meta.url));
const options = { since: '2026-01-01', until: '2026-12-31', idleGapMinutes: 5 };
const scratch: string[] = [];
async function home(withFixture = true) {
  const path = await mkdtemp(join(tmpdir(), 'decadra-devin-test-'));
  scratch.push(path);
  const env = { home: path, platform: 'linux' as const, env: {} };
  await mkdir(join(path, '.local/share/devin/cli'), { recursive: true });
  if (withFixture) await copyFile(fixture, devinDbPath(env));
  return env;
}
afterEach(async () => { for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true }); });

describe('verified Devin SQLite metadata', () => {
  it('counts only main-chain human input and excludes hidden and empty sessions', async () => {
    const env = await home();
    const result = readDevinMetadata(options, env);
    expect(result.error).toBeNull();
    expect(result.malformedRows).toBe(0);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ humanTurns: 1, assistantMessages: 0, toolCalls: 0, toolVersion: null });
    expect(result.resources[0]).toMatchObject({ hidden: false, inputTokens: null, outputTokens: null, latencyMs: null, acu: 0, credits: 0 });
    expect(await devin.localDataStart?.(env)).toBe('2026-09-12');
    expect((await devinReader.read(options, env)).sessions).toEqual(result.sessions);
  });

  it('exposes explicit hidden telemetry without counting duplicated branches', async () => {
    const result = readDevinMetadata(options, await home(), true);
    expect(result.sessions).toHaveLength(2);
    const resource = result.resources.find((r) => r.hidden);
    const session = result.sessions.find((s) => s.sessionId === resource?.sessionId);
    expect(session).toMatchObject({ humanTurns: 2, assistantMessages: 2, toolCalls: 0, toolVersion: null });
    expect(resource).toMatchObject({ latencyMs: 9852, cacheCreationTokens: null, acu: 0, credits: 0 });
    expect(resource?.inputTokens).toBeGreaterThan(0);
    expect(resource?.models.length).toBeGreaterThan(0);
    expect(session?.activeMinutes).toBeLessThanOrEqual(session?.wallMinutes ?? 0);
  });

  it('does not mutate source database or leak content', async () => {
    const env = await home();
    const before = await readFile(devinDbPath(env));
    const text = JSON.stringify(readDevinMetadata(options, env, true));
    for (const marker of CONTENT_PLACEHOLDERS) expect(text).not.toContain(marker);
    expect(await readFile(devinDbPath(env))).toEqual(before);
    const db = openReadOnlyDatabase(devinDbPath(env));
    try { expect(() => db.exec('CREATE TABLE forbidden(value TEXT)')).toThrow(); } finally { db.close(); }
  });

  it('handles absent and incompatible databases without throwing', async () => {
    const env = await home(false);
    expect(readDevinMetadata(options, env)).toMatchObject({ filesRead: 0, sessions: [], error: null });
    expect((await devin.doctor(env))[0]?.status).toBe('absent');
    await writeFile(devinDbPath(env), 'not a database');
    expect(readDevinMetadata(options, env)).toMatchObject({ sessions: [], error: 'unreadable-database' });
    expect((await devin.doctor(env)).find((c) => c.id === 'devin.readOnly')?.status).toBe('warn');
    expect(await devin.localDataStart?.(env)).toBeNull();
    await expect(devinReader.read(options, env)).rejects.toThrow('could not be read');
  });

  it('skips malformed chains and unknown kinds in a scratch copy of real rows', async () => {
    const env = await home();
    const db = new DatabaseSync(devinDbPath(env));
    try {
      db.exec("UPDATE message_nodes SET chat_message=json_set(chat_message, '$.role', 'future-kind') WHERE session_id IN (SELECT id FROM sessions WHERE hidden=0)");
    } finally { db.close(); }
    expect(readDevinMetadata(options, env).sessions).toEqual([]);
    expect(await devin.localDataStart?.(env)).toBeNull();
    const malformed = new DatabaseSync(devinDbPath(env));
    try {
      malformed.exec("UPDATE message_nodes SET chat_message='{' WHERE session_id IN (SELECT id FROM sessions WHERE hidden=0)");
    } finally { malformed.close(); }
    const data = readDevinMetadata(options, env);
    expect(data.error).toBeNull();
    expect(data.malformedRows).toBeGreaterThan(0);
    expect(data.sessions).toEqual([]);
  });

  it('reports writer-version uncertainty and validates rows without accepting bad metrics', async () => {
    const env = await home();
    const checks = await devin.doctor(env);
    expect(checks.find((c) => c.id === 'devin.readOnly')?.status).toBe('ok');
    expect(checks.find((c) => c.id === 'devin.version')?.status).toBe('warn');
    const db = openReadOnlyDatabase(fixture);
    try {
      const id = db.prepare('SELECT id FROM sessions WHERE hidden=1').get()?.id;
      const row = db.prepare(NODE_QUERY).all(String(id))[0];
      expect(nodeSchema.safeParse({ ...row, unexpected: true }).success).toBe(true);
      expect(nodeSchema.safeParse({ ...row, input: -1 }).success).toBe(false);
      const node = nodeSchema.parse(row);
      expect(mainChain([node], 999999)).toBeNull();
      expect(mainChain([{ ...node, parent_node_id: node.node_id }], node.node_id)).toBeNull();
      expect(mainChain([{ ...node, role: 'future-kind' }], node.node_id)).toHaveLength(1);
    } finally { db.close(); }
    expect(readDevinMetadata({ ...options, since: '2027-01-01', until: '2027-12-31' }, env).sessions).toEqual([]);
  });
  it('visibility ignores empty headers and broken or cyclic visible chains', async () => {
    const env = await home();
    const db = new DatabaseSync(devinDbPath(env));
    try {
      db.exec('UPDATE message_nodes SET parent_node_id=node_id WHERE session_id IN (SELECT id FROM sessions WHERE hidden=0)');
    } finally { db.close(); }
    expect(await devin.localDataStart?.(env)).toBeNull();
    const broken = new DatabaseSync(devinDbPath(env));
    try { broken.exec('UPDATE message_nodes SET parent_node_id=999999999 WHERE session_id IN (SELECT id FROM sessions WHERE hidden=0)'); }
    finally { broken.close(); }
    expect(await devin.localDataStart?.(env)).toBeNull();
  });
});
