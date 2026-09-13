import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ScanResult {
  found: boolean;
  files: number;
  newest: string | null;
  oldest: string | null;
}

/**
 * Read-only walk. Counts files matching the predicate up to maxDepth and
 * records the newest mtime. Never opens file contents.
 */
export async function scanDir(
  root: string,
  match: (name: string, relDepth: number) => boolean,
  maxDepth = 6,
): Promise<ScanResult> {
  let files = 0;
  let newest = 0;
  let oldest = Number.POSITIVE_INFINITY;
  let found = false;
  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    found = true;
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
      } else if (e.isFile() && match(e.name, depth)) {
        files += 1;
        try {
          const s = await stat(full);
          if (s.mtimeMs > newest) newest = s.mtimeMs;
          const born = s.birthtimeMs > 0 ? Math.min(s.birthtimeMs, s.mtimeMs) : s.mtimeMs;
          if (born < oldest) oldest = born;
        } catch {
          // unreadable file: counted, not dated
        }
      }
    }
  }
  await walk(root, 0);
  return {
    found,
    files,
    newest: newest ? new Date(newest).toISOString() : null,
    oldest: Number.isFinite(oldest) ? new Date(oldest).toISOString() : null,
  };
}

/**
 * ccusage documents these directory lists as comma separated. Splitting on ':' as well cut
 * a Windows path in half at its drive letter, turning one real root into two that do not
 * exist.
 */
export function splitDirs(value: string | undefined, fallback: string): string[] {
  if (!value) return [fallback];
  const dirs = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return dirs.length ? dirs : [fallback];
}

/** readdir that returns null instead of throwing, for readers that treat a missing directory as empty. */
export async function listDir(dir: string): Promise<string[] | null> {
  try {
    return await readdir(dir);
  } catch {
    return null;
  }
}
