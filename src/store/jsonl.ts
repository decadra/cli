import { appendFile, open, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { ZodType } from 'zod';

/** Whether the file ends with a newline. A file that does not would join two records. */
async function endsWithNewline(file: string): Promise<boolean> {
  const size = (await stat(file)).size;
  if (size === 0) return true;
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(1);
    await fh.read(buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    await fh.close();
  }
}

/**
 * Append-only JSONL. Open in append mode, write one line, never rewrite.
 * Malformed lines are reported, not silently dropped.
 */
export async function appendRecord(file: string, record: unknown): Promise<void> {
  // A previous write cut short, or a file edited by hand, can leave no trailing newline.
  // Appending to that joins two records into one line and loses both.
  const prefix = existsSync(file) && !(await endsWithNewline(file)) ? '\n' : '';
  await appendFile(file, prefix + JSON.stringify(record) + '\n', { flag: 'a' });
}

export async function readRecords<T>(file: string, schema: ZodType<T>): Promise<{ records: T[]; malformed: number }> {
  if (!existsSync(file)) return { records: [], malformed: 0 };
  const text = await readFile(file, 'utf8');
  const records: T[] = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) records.push(parsed.data);
      else malformed += 1;
    } catch {
      malformed += 1;
    }
  }
  return { records, malformed };
}
