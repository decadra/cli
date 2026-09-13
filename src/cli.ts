import { createRequire } from 'node:module';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { resolvePaths } from './config/paths';
import { runBaselineAdd, runBaselineList, type BaselineAddOptions } from './commands/baseline';
import { runAssess, type AssessOptions } from './commands/assess';
import { runNow, type NowOptions } from './commands/now';
import { runSessions } from './commands/sessions';
import { runAlertsCheck, runAlertsList, runAlertsSchedule } from './commands/alerts';
import { fileURLToPath } from 'node:url';
import { runDoctor } from './commands/doctor';
import { offerSetupOnFirstRun, runSetup } from './commands/setup';
import { detectAgent } from './ui/agent-env';
import { runDocs, runPlanned } from './commands/planned';
import { PLANNED } from './roadmap';
import { CliError, type CommandContext, type OutputFormat } from './commands/context';
import { showHome } from './ui/splash';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

/**
 * `--html` belongs to the commands that render a report. It is declared on those two only,
 * so asking any other command for html is an error rather than a flag quietly ignored.
 */
function makeContext(program: Command, cmdOpts?: { html?: string | undefined }): CommandContext {
  const g = program.opts<{ json?: boolean; configDir?: string }>();
  const html = cmdOpts?.html;
  const format: OutputFormat = g.json ? 'json' : html ? 'html' : 'terminal';
  return {
    paths: resolvePaths(g.configDir),
    format,
    htmlPath: html,
    write: (text) => process.stdout.write(text + '\n'),
    version,
  };
}

function number(value: string): number {
  // Number('') is 0 and Number('  ') is 0, so an empty --price silently recorded a free plan.
  if (value.trim() === '') throw new InvalidArgumentError('expected a number, got an empty value');
  const n = Number(value);
  if (!Number.isFinite(n)) throw new InvalidArgumentError('expected a number');
  return n;
}

async function run(): Promise<void> {
  const program = new Command('decadra')
    .description('Does the AI coding plan you pay for fit the usage you put through it. Per provider, never across providers.')
    .version(version)
    .option('--json', 'machine output')
    .option('--config-dir <dir>', 'config directory (default: $DECADRA_HOME or ~/.decadra)')
    .option('--no-animation', 'static home screen')
    .showHelpAfterError();

  const baseline = program.command('baseline').description('append-only snapshots of every subscription you hold');
  baseline
    .command('add')
    .description('record a snapshot; prompts for anything missing on a terminal')
    .option('--provider <id>', 'provider id from plans.json, or any name for products decadra does not ingest')
    .option('--product <name>', 'product name, e.g. "Claude Max 20x"')
    .option('--tier <planId>', 'plan id from plans.json (required for ingested providers)')
    .option('--price <usd>', 'price per billing period', number)
    .option('--currency <code>', 'ISO 4217 code', 'USD')
    .option('--billing <period>', 'monthly or annual', 'monthly')
    .option('--as-of <date>', 'YYYY-MM-DD the snapshot describes (default today)')
    .option('--note <text>')
    .option('--supersedes <id>', 'id of the snapshot this one corrects')
    .option('--force', 'append even if an identical snapshot exists')
    .option('-i, --interactive', 'prompt for every field')
    .action(async (opts: BaselineAddOptions) => {
      await runBaselineAdd(makeContext(program), opts);
    });
  baseline
    .command('list')
    .description('show every snapshot, newest first')
    .action(async () => {
      await runBaselineList(makeContext(program));
    });

  program
    .command('now')
    .description('the in-session money meter: this session, today, month to date, against the plan you hold')
    .option('-a, --all', 'every provider, not only the detected one')
    .option('--provider <id>', 'force a provider instead of detecting from the environment')
    .option('--timing', 'show how long the readout took')
    .action(async (opts: NowOptions) => {
      process.exitCode = await runNow(makeContext(program), opts);
    });

  program
    .command('assess')
    .description('plan fit and effective cost under every plan, one provider at a time')
    .option('--months <n>', 'calendar months including the current one', number, 3)
    .option('--since <date>', 'YYYY-MM-DD, overrides --months')
    .option('--until <date>', 'YYYY-MM-DD, default today')
    .option('--provider <id...>', 'limit to these provider ids')
    .option('--html <file>', 'write a self-contained html report')
    .action(async (opts: AssessOptions) => {
      process.exitCode = await runAssess(makeContext(program, opts), opts);
    });

  program
    .command('sessions')
    .description('effort per session: turns, wall and active duration, tool calls, commit signals; medians per provider')
    .option('--months <n>', 'calendar months including the current one', number, 3)
    .option('--since <date>', 'YYYY-MM-DD, overrides --months')
    .option('--until <date>', 'YYYY-MM-DD, default today')
    .option('--provider <id...>', 'limit to these provider ids')
    .option('--html <file>', 'write a self-contained html report')
    .action(async (opts: AssessOptions) => {
      process.exitCode = await runSessions(makeContext(program, opts), opts);
    });

  program
    .command('setup')
    .description('what this machine uses and what you pay for; re-run any time to change it')
    .action(async () => {
      process.exitCode = await runSetup(makeContext(program));
    });

  program
    .command('doctor')
    .description('check config, local data directories for every provider, git and ccusage')
    .action(async () => {
      process.exitCode = await runDoctor(makeContext(program));
    });

  const alerts = program.command('alerts').description('plan-change alerts from stored verdict history; one provider at a time');
  alerts
    .command('check')
    .description('evaluate the rules; quiet and exit 0 when nothing fires, so it is safe under cron or launchd')
    .action(async () => {
      process.exitCode = await runAlertsCheck(makeContext(program));
    });
  alerts
    .command('list')
    .description('alerts fired so far')
    .action(async () => {
      process.exitCode = await runAlertsList(makeContext(program));
    });
  alerts
    .command('schedule')
    .description('print the cron or launchd entry that runs alerts check')
    .option('--weekly', 'Monday 09:00 (default)')
    .option('--daily', '09:00 every day')
    .option('--print', 'print the entry instead of installing it (installing is not done by decadra)')
    .action((opts: unknown) => {
      process.exitCode = runAlertsSchedule(makeContext(program), opts, process.platform, process.execPath, fileURLToPath(import.meta.url));
    });

  for (const name of Object.keys(PLANNED)) {
    program
      .command(name)
      .description('planned; open work is listed in docs/plans/README.md')
      .allowUnknownOption()
      .allowExcessArguments()
      .action(() => {
        process.exitCode = runPlanned(makeContext(program), name);
      });
  }

  program.command('docs').description('where the manual lives').action(() => runDocs(makeContext(program)));

  program.action(async () => {
    const ctx = makeContext(program);
    const g = program.opts<{ animation?: boolean }>();
    if (detectAgent(process.env)) {
      // Inside an agent's shell: the readout, never the splash.
      process.exitCode = await runNow(ctx, {});
      return;
    }
    if (!process.stdout.isTTY || !process.stdin.isTTY || ctx.format !== 'terminal') {
      program.help();
      return;
    }
    // Asked before the splash, and only on a terminal: the two returns above have already
    // taken the agent shell and the piped run out of reach.
    await offerSetupOnFirstRun(ctx);
    const animate = g.animation !== false && !process.env['DECADRA_NO_ANIMATION'] && !process.env['CI'];
    const choice = await showHome({ version, animate });
    switch (choice) {
      case 'baseline':
        await runBaselineList(ctx);
        process.stdout.write(pc.dim('\nadd one with: decadra baseline add\n'));
        break;
      case 'assess':
        process.exitCode = await runAssess(ctx, {});
        break;
      case 'sessions':
        process.exitCode = await runSessions(ctx, {});
        break;
      case 'setup':
        process.exitCode = await runSetup(ctx);
        break;
      case 'doctor':
        process.exitCode = await runDoctor(ctx);
        break;
      case 'docs':
        runDocs(ctx);
        break;
      case 'exit':
        break;
      default:
        process.exitCode = runPlanned(ctx, choice);
    }
  });

  await program.parseAsync(process.argv);
}

run().catch((e: unknown) => {
  if (e instanceof CliError) {
    if (e.exitCode !== 130) process.stderr.write(pc.red(`error: ${e.message}`) + '\n');
    process.exitCode = e.exitCode;
    return;
  }
  process.stderr.write(pc.red(`error: ${e instanceof Error ? e.message : String(e)}`) + '\n');
  process.exitCode = 1;
});
