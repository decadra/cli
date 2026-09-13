import type { SessionRecord, UtilizationSample, ProviderId } from '../ingest/types';
import type { MeterUnit, UsageSourceConfig } from '../config/plans';

export type { ProviderId, MeterUnit };

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'absent';

export interface DoctorCheck {
  id: string;
  provider: ProviderId | null;
  status: DoctorStatus;
  summary: string;
  detail?: string;
}

export interface DoctorEnv {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

export interface ReadOptions {
  /** YYYY-MM-DD inclusive, UTC. Sessions whose last line falls inside count. */
  since: string;
  until: string;
  idleGapMinutes: number;
}

export interface ReadResult {
  sessions: SessionRecord[];
  utilization: UtilizationSample[];
  filesRead: number;
}

export interface SessionReader {
  /** Reader version pin: the tool version the reader was verified against. */
  verifiedAgainst: string;
  /**
   * Whether this tool writes its own rate-limit snapshots. Readers that do not should not
   * be run by a caller that only wants utilization, because parsing every transcript to
   * collect an empty array is the most expensive way to learn nothing.
   */
  providesUtilization: boolean;
  read(opts: ReadOptions, env: DoctorEnv): Promise<ReadResult>;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  meter: MeterUnit;
  usage: UsageSourceConfig;
  sessions?: SessionReader;
  doctor(env: DoctorEnv): Promise<DoctorCheck[]>;
  /** Earliest date (YYYY-MM-DD) with local data on disk, or null. Lets assess exclude months before the logs begin. */
  localDataStart?(env: DoctorEnv): Promise<string | null>;
}

export function check(
  provider: ProviderId | null,
  id: string,
  status: DoctorStatus,
  summary: string,
  detail?: string,
): DoctorCheck {
  return detail === undefined ? { id, provider, status, summary } : { id, provider, status, summary, detail };
}
