/**
 * Build the public release mirror: the tracked tree minus everything the policy
 * file excludes, with the few shared files that reference excluded modules
 * rewritten so the result still compiles on its own.
 *
 * Usage: tsx scripts/build-public-tree.ts [repoRoot] [outDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type Policy = { exclude: string[] };

const repo = resolve(process.argv[2] ?? '.');
const out = resolve(process.argv[3] ?? 'public-tree');
const policy = JSON.parse(readFileSync(join(repo, 'public-tree.json'), 'utf8')) as Policy;

/** A trailing slash means the whole directory, otherwise the path must match exactly. */
const isExcluded = (p: string): boolean =>
  policy.exclude.some((e) => (e.endsWith('/') ? p.startsWith(e) : p === e));

const tracked = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

rmSync(out, { recursive: true, force: true });
const kept: string[] = [];
const dropped: string[] = [];
for (const f of tracked) {
  if (isExcluded(f)) {
    dropped.push(f);
    continue;
  }
  const dest = join(out, f);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(repo, f), dest);
  kept.push(f);
}

const edits: string[] = [];
/** Rewrite a shared file, failing loudly if the expected shape is no longer there. */
function edit(rel: string, fn: (s: string) => string): void {
  const p = join(out, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`transform made no change, the source shape moved: ${rel}`);
  writeFileSync(p, after);
  edits.push(rel);
}

// The route command and its registration go with the excluded modules.
edit('src/cli.ts', (s) =>
  s
    .replace(/^import \{[^}]*\} from '\.\/commands\/route';\n/m, '')
    .replace(/^\s*const route = program\.command\('route'\).*\n(?:^\s*route\.command\(.*\n)+/m, ''),
);

// The settings key stays tolerated so a file written by a build that has routing
// still validates against the strict schema here.
edit('src/config/settings.ts', (s) =>
  s
    .replace(/^import \{ routingSettingsSchema \} from '\.\.\/routing\/schema';\n/m, '')
    .replace(
      /^\s*routing: routingSettingsSchema\.default\(\{ pools: \[\] \}\),\n/m,
      '  /** Tolerated and ignored here. Carried so settings written elsewhere still validate. */\n  routing: z.unknown().optional(),\n',
    ),
);

// The public package ships only the command line entry.
edit('README.md', s => s.replace(/The package also exports a programmatic routing core[^.]*\(.*?\); the command line is built on it\. /, ''));
edit('docs/architecture/commands.md', s => s.split('\n').filter(line =>
  !line.startsWith('| `route ') && !line.startsWith('`route record`') && !line.startsWith('The route commands are adapters')).join('\n'));
edit('docs/testing/README.md', s => s.replace(/ `npm run test:consumer` packs .*?contract\./, '').replace('CI runs both', 'CI runs the suite'));
edit('tsup.config.ts', (s) => s.replace(/^ {2}\{ \.\.\.shared, entry: \{ index: 'src\/index\.ts' \}[^\n]*\n/m, ''));
edit('package.json', (s) => {
  const pkg = JSON.parse(s);
  delete pkg.exports;
  delete pkg.types;
  delete pkg.scripts['test:consumer'];
  return JSON.stringify(pkg, null, 2) + '\n';
});

// The module consumer check is private along with the module entry.
edit('.github/workflows/ci.yml', (s) =>
  s.replace(/^ {10}cd "\$GITHUB_WORKSPACE"\n {10}npm run test:consumer\n/m, ''),
);

// Source maps embed the original sources, which would republish what was excluded.
edit('tsup.config.ts', (s) => s.replace(/\bsourcemap: true\b/, 'sourcemap: false'));

writeFileSync(
  join(out, 'MIRROR.md'),
  '# About this repository\n\n' +
    'This is the public release mirror of Decadra. It is generated from a private\n' +
    'working repository and holds the source of the current release.\n\n' +
    'Development, including work that is not yet released, happens privately. What\n' +
    'that means in practice is listed below, so you can see the boundary rather than\n' +
    'guess at it.\n\n## Not present here\n\n' +
    dropped
      .slice()
      .sort()
      .map((d) => `- \`${d}\``)
      .join('\n') +
    '\n\n## Present but modified here\n\n' +
    'These files exist upstream in a fuller form. The differences are the parts that\n' +
    'reference the modules listed above, plus the build not emitting source maps.\n\n' +
    edits
      .slice()
      .sort()
      .map((e) => `- \`${e}\``)
      .join('\n') +
    '\n\n## Reporting a problem\n\n' +
    'Open an issue. Pull requests against this repository are not merged directly,\n' +
    'because it is generated, but they are read and applied upstream.\n',
);

process.stdout.write(`kept ${kept.length}, dropped ${dropped.length}, rewrote ${edits.length}\n`);
