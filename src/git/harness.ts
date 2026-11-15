import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execa } from 'execa';
import { homedir } from 'node:os';
import { discoveryEnv } from './session-scope';
import { parse } from 'smol-toml';
import { z } from 'zod';

export async function repositoryRoot(cwd: string) {
  const result = await execa('git', ['rev-parse', '--show-toplevel'], { cwd, reject: false, extendEnv: false, env: discoveryEnv() });
  return realpath(result.exitCode === 0 ? result.stdout : cwd);
}

function within(root: string, path: string) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}

export async function repositoryDirectories(cwd: string) {
  const root = await repositoryRoot(cwd);
  const leaf = await realpath(cwd);
  const directories = [root];
  if (within(root, leaf)) {
    for (const part of relative(root, leaf).split(sep).filter(Boolean)) directories.push(join(directories.at(-1)!, part));
  }
  return directories;
}

async function available(path: string) {
  try { return (await stat(path)).isFile(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

async function codexFile(directory: string, fallbacks: string[] = []) {
  for (const name of ['AGENTS.override.md', 'AGENTS.md', ...fallbacks]) {
    const path = join(directory, name);
    if (await available(path) && (await stat(path)).size > 0) {
      if ((await stat(path)).size > 262144 || (await readFile(path, 'utf8')).trim()) return path;
    }
  }
  return null;
}

export async function checkHarness(cwd: string) {
  const directories = await repositoryDirectories(cwd);
  const root = directories[0]!;
  const globalFiles = {
    codex: await codexFile(process.env.CODEX_HOME || join(homedir(), '.codex')),
    claude: await available(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'CLAUDE.md')),
  };
  const layers = [];
  let fallbacks: string[] = [];
  let unknown = false;
  for (const directory of [process.env.CODEX_HOME || join(homedir(), '.codex'), ...directories.map(d => join(d, '.codex'))]) {
    const config = join(directory, 'config.toml');
    if (!await available(config)) continue;
    try {
      const value = parse(await readFile(config, 'utf8'), { integersAsBigInt: 'asNeeded' }).project_doc_fallback_filenames;
      if (value !== undefined) fallbacks = z.array(z.string().regex(/^[^/\\]+$/).refine(n => n !== '.' && n !== '..')).parse(value);
    } catch { unknown = true; }
  }
  for (const directory of directories) {
    const codex = await codexFile(directory, fallbacks);
    const claude = [];
    for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
      if (await available(join(directory, name))) claude.push(join(directory, name));
    }
    layers.push({ directory, codex, claude });
  }
  const visited = new Set<string>();
  const missing: string[] = [];
  async function walk(file: string, depth: number): Promise<void> {
    if (depth > 5 || visited.size >= 64 || !within(root, file)) { unknown = true; return; }
    try {
      const path = await realpath(file);
      if (!within(root, path)) { unknown = true; return; }
      if (visited.has(path)) return;
      visited.add(path);
      const info = await stat(path);
      if (!info.isFile() || info.size > 262144) { unknown = true; return; }
      const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
      let fence = '';
      for (const line of lines) {
        const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker && (!fence || marker.startsWith(fence))) { fence = fence ? '' : marker; continue; }
        if (fence) continue;
        const prose = line.replace(/(`+).*?\1/g, ' ');
        for (const match of prose.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
          const ref = match[1]!.replace(/[.,;:!?]+$/, '');
          if (!ref.startsWith('~') && !isAbsolute(ref)) await walk(resolve(dirname(path), ref), depth + 1);
          else unknown = true;
        }
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') missing.push(relative(root, file));
      else unknown = true;
    }
  }
  for (const layer of layers) for (const path of layer.claude) await walk(path, 0);
  const canonical = layers.flatMap(layer => layer.codex ? [layer.codex] : []);
  const resolved = await Promise.all(canonical.map(path => realpath(path)));
  const shared = resolved.length > 0 && resolved.every(path => visited.has(path));
  if (!layers.some(layer => layer.claude.length)) missing.push('CLAUDE.md');
  if (!unknown && !canonical.length && !missing.includes('AGENTS.md')) missing.push('AGENTS.md');
  const state = missing.length ? 'missing' : unknown ? 'unknown' : shared ? 'shared' : 'independent';
  return { schemaVersion: 1, scope: 'repository', state, missing, globalFiles, layers, repair: missing.length ? 'Restore the referenced file or correct its import.' : null };
}
