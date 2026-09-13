import type { DecadraPaths } from '../config/paths';

export type OutputFormat = 'terminal' | 'json' | 'html';

export interface CommandContext {
  paths: DecadraPaths;
  format: OutputFormat;
  htmlPath: string | undefined;
  write: (text: string) => void;
  version: string;
}

export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = 'CliError';
  }
}
