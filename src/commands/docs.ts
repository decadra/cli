import type { CommandContext } from './context';

export function runDocs(ctx: CommandContext): void {
  ctx.write(
    [
      'Manual and design:',
      '  https://github.com/rishabbalak/decadra#readme',
      `  https://github.com/rishabbalak/decadra/blob/main/docs/plans/README.md`,
      '  https://github.com/rishabbalak/decadra/blob/main/docs/adding-a-provider.md',
      '',
      `Config dir: ${ctx.paths.root}`,
    ].join('\n'),
  );
}
