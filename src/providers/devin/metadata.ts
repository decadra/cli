import { z } from 'zod';

const count = z.number().finite().nonnegative();
const integer = count.int();
const identifier = z.string().min(1).max(512);
const model = z.union([z.literal('<synthetic>'), z.string().max(100).regex(/^[a-z0-9_./:-]*$/i)]);
const seconds = integer.max(253402300799);
export const sessionSchema = z.object({
  id: identifier, working_directory: z.string().max(4096), model,
  created_at: seconds, last_activity_at: seconds, main_chain_id: integer.nullable(), hidden: z.union([z.literal(0), z.literal(1)]),
  acu: count.nullable(), credits: count.nullable(), tool_version: z.string().max(80).nullable(),
});
export const nodeSchema = z.object({
  node_id: integer, parent_node_id: integer.nullable(), created_at: seconds,
  role: z.string().max(40), message_id: identifier.nullable(), human: z.union([z.literal(0), z.literal(1)]).nullable(),
  model: model.nullable(), timestamp: z.iso.datetime({ offset: true }).nullable(), tools: integer.nullable(),
  input: integer.nullable(), output: integer.nullable(), cache_read: integer.nullable(), cache_write: integer.nullable(), latency: count.nullable(),
});
export type DevinNode = z.infer<typeof nodeSchema>;

export const SESSION_QUERY = `SELECT id, working_directory, model, created_at, last_activity_at, main_chain_id, hidden,
  json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.total_acu_cost') AS acu,
  json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.total_credit_cost') AS credits,
  json_extract(CASE WHEN json_valid(metadata) THEN metadata END, '$.cli_version') AS tool_version FROM sessions`;

// JSON projections keep message content, thinking, tool arguments, and results inside SQLite.
export const NODE_QUERY = `SELECT node_id, parent_node_id, created_at,
  json_extract(chat_message, '$.role') AS role,
  json_extract(chat_message, '$.message_id') AS message_id,
  json_extract(chat_message, '$.metadata.is_user_input') AS human,
  json_extract(chat_message, '$.metadata.generation_model') AS model,
  json_extract(chat_message, '$.metadata.created_at') AS timestamp,
  CASE WHEN json_type(chat_message, '$.tool_calls') = 'array' THEN json_array_length(chat_message, '$.tool_calls') END AS tools,
  json_extract(chat_message, '$.metadata.metrics.input_tokens') AS input,
  json_extract(chat_message, '$.metadata.metrics.output_tokens') AS output,
  json_extract(chat_message, '$.metadata.metrics.cache_read_tokens') AS cache_read,
  json_extract(chat_message, '$.metadata.metrics.cache_creation_tokens') AS cache_write,
  json_extract(chat_message, '$.metadata.metrics.total_time_ms') AS latency
  FROM message_nodes WHERE session_id = ? AND json_valid(chat_message)`;

/** A broken chain cannot establish whether a row belongs to the main conversation. */
export function mainChain(nodes: DevinNode[], head: number | null): DevinNode[] | null {
  const byId = new Map(nodes.map((node) => [node.node_id, node]));
  const visited = new Set<number>();
  const chain: DevinNode[] = [];
  while (head !== null) {
    if (visited.has(head)) return null;
    visited.add(head);
    const node = byId.get(head);
    if (!node) return null;
    chain.push(node);
    head = node.parent_node_id;
  }
  return chain.reverse();
}

export interface DevinResources {
  sessionId: string;
  hidden: boolean;
  models: string[];
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  latencyMs: number | null;
  acu: number | null;
  credits: number | null;
}
