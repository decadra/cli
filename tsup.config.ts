import { defineConfig } from 'tsup';

const shared = { format: 'esm' as const, target: 'node22' as const, platform: 'node' as const, removeNodeProtocol: false, sourcemap: false, splitting: false };

// Two entries, one package: the command line and the module the command line is built on.
// Only the module ships declarations, and only the command line carries a shebang.
export default defineConfig([
  { ...shared, entry: { cli: 'src/cli.ts' }, clean: true, banner: { js: '#!/usr/bin/env node' } },
  { ...shared, entry: { observe: 'src/observe.ts' }, clean: false, noExternal: ['zod'], banner: { js: '#!/usr/bin/env -S node --disable-warning=ExperimentalWarning' } },
]);
