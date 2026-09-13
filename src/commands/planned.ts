import pc from 'picocolors';
import { notBuiltYet, PLANNED_DOCS, PLANNED_DOCS_URL } from '../roadmap';
import type { CommandContext } from './context';

export function runPlanned(ctx: CommandContext, name: string): number {
  if (ctx.format === 'json') ctx.write(JSON.stringify({ command: name, available: false, plannedDocs: PLANNED_DOCS }, null, 2));
  else ctx.write(pc.yellow(notBuiltYet(name)));
  return 2;
}

export function runDocs(ctx: CommandContext): void {
  ctx.write(
    [
      'Manual and design:',
      '  https://github.com/rishabbalak/decadra#readme',
      `  ${PLANNED_DOCS_URL}`,
      '  https://github.com/rishabbalak/decadra/blob/main/docs/adding-a-provider.md',
      '',
      `Config dir: ${ctx.paths.root}`,
    ].join('\n'),
  );
}
