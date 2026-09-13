import { existsSync } from 'node:fs';
import { z } from 'zod';
import { openReadOnlyDatabase } from '../../ingest/sqlite';

// Only topology and activity timestamps are projected. UNION bounds broken cycles.
const FIRST_ACTIVITY = `WITH RECURSIVE chain(session_id, node_id, parent_node_id) AS (
  SELECT s.id, n.node_id, n.parent_node_id FROM sessions s
  JOIN message_nodes n ON n.session_id = s.id AND n.node_id = s.main_chain_id
  WHERE s.hidden = 0
  UNION
  SELECT c.session_id, n.node_id, n.parent_node_id FROM chain c
  JOIN message_nodes n ON n.session_id = c.session_id AND n.node_id = c.parent_node_id
), rooted AS (
  SELECT session_id FROM chain GROUP BY session_id
  HAVING SUM(parent_node_id IS NULL) = 1
), activity AS (
  SELECT c.session_id, n.created_at, json_valid(n.chat_message) AS valid,
    json_extract(CASE WHEN json_valid(n.chat_message) THEN n.chat_message END, '$.role') AS role,
    json_extract(CASE WHEN json_valid(n.chat_message) THEN n.chat_message END, '$.metadata.created_at') AS timestamp,
    json_extract(CASE WHEN json_valid(n.chat_message) THEN n.chat_message END, '$.metadata.is_user_input') AS human,
    json_extract(CASE WHEN json_valid(n.chat_message) THEN n.chat_message END, '$.metadata.generation_model') AS model
  FROM chain c JOIN rooted r ON r.session_id = c.session_id
  JOIN message_nodes n ON n.session_id = c.session_id AND n.node_id = c.node_id
)
SELECT MIN(strftime('%Y-%m-%dT%H:%M:%fZ', COALESCE(
  timestamp, datetime(created_at, 'unixepoch')
))) AS firstTs FROM activity a
WHERE NOT EXISTS (SELECT 1 FROM activity bad WHERE bad.session_id = a.session_id AND bad.valid = 0)
AND ((role = 'user' AND human = 1) OR (role = 'assistant' AND COALESCE(model, '') != '<synthetic>'))`;

/** Visibility needs one date, not normalized messages or resource metrics. */
export function firstDevinActivity(path: string): string | null {
  if (!existsSync(path)) return null;
  let db: ReturnType<typeof openReadOnlyDatabase> | undefined;
  try {
    db = openReadOnlyDatabase(path);
    const row = z.object({ firstTs: z.iso.datetime().nullable() }).safeParse(db.prepare(FIRST_ACTIVITY).get());
    return row.success ? row.data.firstTs?.slice(0, 10) ?? null : null;
  } catch { return null; } finally { db?.close(); }
}
